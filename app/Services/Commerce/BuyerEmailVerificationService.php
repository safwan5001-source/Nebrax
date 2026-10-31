<?php

namespace App\Services\Commerce;

use App\Mail\BuyerVerificationMail;
use App\Models\CustomerEmailVerificationToken;
use App\Models\CustomerIdentity;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use LogicException;
use Throwable;

/**
 * H6 Batch H — e-mail verification of a wholesale-buyer {@see CustomerIdentity}.
 *
 * Guarantees:
 *  - the token is 64 random chars; only its SHA-256 is stored, it expires (`commerce.buyer_verification_ttl_minutes`)
 *    and is single-use; verifying also retires every other outstanding token of the identity;
 *  - tokens are bound to tenant + sales channel (the host the registration came through). The tenant comes from the
 *    Host-resolved {@see TenantContext}, the channel from {@see StorefrontContext}; neither is ever read from the
 *    request. A token presented through another tenant, another channel/host, after expiry, or a second time all fail
 *    identically and a wrong-host attempt does NOT consume the token;
 *  - the link host is the storefront's own verified, active domain — never the request's Host/Origin header, never
 *    client input; only an optional `/xx/yy` locale prefix (strictly validated) is client-influenced and it cannot
 *    change the host;
 *  - mail goes through the platform's existing mail transport (`Mail::to()->send()`, Resend HTTPS in production).
 *    A new token supersedes older ones only AFTER the mail was handed to the transport (a transport failure keeps the
 *    previous link working and is logged without any secret or address);
 *  - this service never tells the caller whether an identity exists: it returns nothing for the unknown / already
 *    verified / inactive / cooling-down cases, and callers run it after the response so timing does not leak either.
 *
 * Login stays strictly gated by `email_verified_at` ({@see \App\Services\CustomerAuthenticationService::login()}).
 */
class BuyerEmailVerificationService
{
    public function __construct(
        private TenantContext $tenantContext,
        private StorefrontContext $storefrontContext,
    ) {}

    /** `/xx/yy` (country/locale) prefix the storefront serves; anything else is dropped. */
    public static function sanitizeLocalePath(?string $path): string
    {
        return is_string($path) && preg_match('#^/[a-z]{2}/[a-z]{2}$#', $path) === 1 ? $path : '';
    }

    /**
     * Issue and e-mail a verification link. Silent no-op (returns false) for an unknown / inactive / already
     * verified identity or inside the resend gap.
     */
    public function sendFor(string $identityId, string $localePath = ''): bool
    {
        $tenantId = $this->requireTenant();
        $channelId = $this->requireChannel();

        $identity = CustomerIdentity::query()->whereKey($identityId)->first();
        if ($identity === null || ! $identity->is_active || $identity->email_verified_at !== null) {
            return false;
        }

        $gap = max(0, (int) config('commerce.buyer_verification_resend_gap_seconds'));
        $recent = CustomerEmailVerificationToken::query()
            ->where('customer_identity_id', $identity->id)
            ->where('created_at', '>', now()->subSeconds($gap))
            ->exists();
        if ($gap > 0 && $recent) {
            return false;
        }

        $host = $this->storeHostname();
        if ($host === null) {
            Log::warning('buyer verification skipped: storefront has no verified active domain', ['tenant_id' => $tenantId, 'channel_id' => $channelId]);

            return false;
        }

        $ttl = max(5, (int) config('commerce.buyer_verification_ttl_minutes'));
        $plain = Str::random(64);
        $previousIds = CustomerEmailVerificationToken::query()
            ->where('customer_identity_id', $identity->id)->whereNull('used_at')->pluck('id')->all();

        $token = CustomerEmailVerificationToken::query()->create([
            'tenant_id' => $tenantId,
            'customer_identity_id' => $identity->id,
            'sales_channel_id' => $channelId,
            'token_hash' => hash('sha256', $plain),
            'expires_at' => now()->addMinutes($ttl),
        ]);
        $tokenId = $token->id;

        $url = 'https://'.$host.self::sanitizeLocalePath($localePath).BuyerPasswordResetService::pagePrefix().'/verify?token='.$plain;
        $storeName = (string) (Tenant::query()->whereKey($tenantId)->value('name') ?? '');

        try {
            Mail::to($identity->email)->send(new BuyerVerificationMail($url, $storeName, $ttl, BuyerPasswordResetService::pagePrefix() === '/account'));
        } catch (Throwable $e) {
            // The candidate token was never delivered: retire it, keep the previous link usable, leak nothing.
            CustomerEmailVerificationToken::query()->whereKey($tokenId)->update(['used_at' => now()]);
            Log::warning('buyer verification mail failed', ['tenant_id' => $tenantId, 'identity_id' => $identity->id, 'exception' => $e::class]);

            return false;
        }

        if ($previousIds !== []) {
            CustomerEmailVerificationToken::query()->whereIn('id', $previousIds)->update(['used_at' => now()]);
        }

        return true;
    }

    /**
     * Consume a presented token. True only when it was valid for THIS tenant and THIS channel, unused and
     * unexpired — then the identity is marked verified. Every other case is a plain false.
     */
    public function verify(string $plain): bool
    {
        $this->requireTenant();
        $channelId = $this->requireChannel();

        if (strlen($plain) !== 64) {
            return false;
        }

        $hash = hash('sha256', $plain);

        return DB::transaction(function () use ($hash, $channelId): bool {
            // Lock order is always identity → token, never token → identity (Codex, PR #1819, P2): two outstanding tokens of one
            // identity (concurrent resends can leave two) are each locked by their own verification; with token-first locking one
            // would hold token A and wait for the identity while the other holds the identity and waits for token A while
            // retiring it — a PostgreSQL deadlock surfacing as HTTP 500. So find the owner unlocked, lock the identity, and only
            // then lock and re-validate the token.
            $ownerId = CustomerEmailVerificationToken::query()->where('token_hash', $hash)->value('customer_identity_id');
            if (! is_string($ownerId)) {
                return false;
            }

            $identity = CustomerIdentity::query()->whereKey($ownerId)->lockForUpdate()->first();
            if ($identity === null || ! $identity->is_active) {
                return false;
            }

            $token = CustomerEmailVerificationToken::query()
                ->where('token_hash', $hash)
                ->where('customer_identity_id', $identity->id)
                ->lockForUpdate()
                ->first();

            if ($token === null
                || $token->used_at !== null
                || ! $token->expires_at->isFuture()
                || $token->sales_channel_id !== $channelId
            ) {
                return false;
            }

            $now = now();
            CustomerEmailVerificationToken::query()
                ->where('customer_identity_id', $identity->id)->whereNull('used_at')->update(['used_at' => $now]);

            if ($identity->email_verified_at === null) {
                $identity->forceFill(['email_verified_at' => $now])->save();
            }

            return true;
        });
    }

    /** The storefront's own hostname: primary first, then any verified+active domain. Never a request header. */
    private function storeHostname(): ?string
    {
        if (! $this->storefrontContext->hasStorefront()) {
            return null;
        }

        $host = StorefrontDomain::query()
            ->where('storefront_id', $this->storefrontContext->storefrontId())
            ->where('is_active', true)
            ->where('verification_status', StorefrontDomain::VERIFICATION_VERIFIED)
            ->orderByDesc('is_primary')
            ->orderBy('created_at')
            ->value('hostname');

        return is_string($host) && $host !== '' ? $host : null;
    }

    private function requireTenant(): string
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required for buyer e-mail verification.');
        }

        return (string) $this->tenantContext->id();
    }

    private function requireChannel(): string
    {
        if (! $this->storefrontContext->isEstablished()) {
            throw new LogicException('StorefrontContext is required for buyer e-mail verification.');
        }

        return $this->storefrontContext->salesChannelId();
    }
}
