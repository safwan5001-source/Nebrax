<?php

namespace App\Services\Commerce;

use App\Mail\BuyerPasswordResetMail;
use App\Models\CustomerIdentity;
use App\Models\CustomerPasswordResetToken;
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
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch M — إعادة تعيين كلمة مرور مشتري الجملة (على نمط تأكيد البريد المعتمد حرفياً)
 * ═══════════════════════════════════════════════════════════════
 *  نفس ضمانات {@see BuyerEmailVerificationService}، في جدول مستقل (`customer_password_reset_tokens`) فلا يمكن أن يعيد رابطُ تأكيد
 *  ضبطَ كلمة مرور ولا أن يؤكّد رابطُ إعادة التعيين بريداً:
 *   - الرمز 64 محرفاً عشوائياً؛ يُخزَّن SHA-256 فقط؛ ينتهي (`commerce.buyer_password_reset_ttl_minutes`) ولمرة واحدة؛ والإتمام يُنهي كل
 *     رموز الهوية الأخرى؛
 *   - مربوط بالمستأجر **والقناة** (المضيف الذي جاء منه الطلب). المستأجر من `TenantContext` المحسوم بالـ Host والقناة من
 *     `StorefrontContext`؛ لا يُقرآن من الطلب أبداً. رمز عبر مستأجر/قناة أخرى أو منتهٍ أو مستعمل يفشل بالطريقة نفسها ولا يُستهلك؛
 *   - مضيف الرابط هو نطاق المتجر الموثَّق النشط نفسه — لا ترويسة الطلب؛ وحده بادئة `/xx/yy` تتأثر بالعميل (صارمة التحقق)؛
 *   - البريد عبر وسيلة النقل القائمة (`Mail::to()->send()`)؛ رمز جديد لا يلغي القديم إلا **بعد** تسليم البريد للنقل؛
 *   - لا يكشف وجود الحساب: لا شيء يُرسل لهوية غير موجودة/معطَّلة/غير مؤكَّدة البريد/داخل فترة الانتظار، والمتحكّم يستدعيه بعد الاستجابة؛
 *   - **لا يُؤكِّد البريد** ولا يُعفي من شرط التأكيد عند الدخول: إعادة التعيين لهويات مؤكَّدة فقط؛
 *   - الإتمام يغيّر كلمة المرور ويُنهي **كل** جلسات الهوية (رموز Sanctum) في كل القنوات، ثم لا يُسجِّل دخولاً تلقائياً.
 */
class BuyerPasswordResetService
{
    public function __construct(
        private TenantContext $tenantContext,
        private StorefrontContext $storefrontContext,
    ) {}

    /** Issue and e-mail a reset link. Silent no-op (false) for an unknown / inactive / unverified identity or inside the gap. */
    public function sendFor(string $identityId, string $localePath = ''): bool
    {
        $tenantId = $this->requireTenant();
        $channelId = $this->requireChannel();

        $identity = CustomerIdentity::query()->whereKey($identityId)->first();
        if ($identity === null || ! $identity->is_active || $identity->email_verified_at === null) {
            return false;
        }

        $gap = max(0, (int) config('commerce.buyer_password_reset_resend_gap_seconds'));
        if ($gap > 0 && CustomerPasswordResetToken::query()
            ->where('customer_identity_id', $identity->id)
            ->where('created_at', '>', now()->subSeconds($gap))
            ->exists()) {
            return false;
        }

        $host = $this->storeHostname();
        if ($host === null) {
            Log::warning('buyer password reset skipped: storefront has no verified active domain', ['tenant_id' => $tenantId, 'channel_id' => $channelId]);

            return false;
        }

        $ttl = max(5, (int) config('commerce.buyer_password_reset_ttl_minutes'));
        $plain = Str::random(64);
        $previousIds = CustomerPasswordResetToken::query()
            ->where('customer_identity_id', $identity->id)->whereNull('used_at')->pluck('id')->all();

        $tokenId = CustomerPasswordResetToken::query()->create([
            'tenant_id' => $tenantId,
            'customer_identity_id' => $identity->id,
            'sales_channel_id' => $channelId,
            'token_hash' => hash('sha256', $plain),
            'expires_at' => now()->addMinutes($ttl),
        ])->id;

        $url = 'https://'.$host.BuyerEmailVerificationService::sanitizeLocalePath($localePath).self::pagePrefix().'/reset-password?token='.$plain;
        $storeName = (string) (Tenant::query()->whereKey($tenantId)->value('name') ?? '');

        try {
            Mail::to($identity->email)->send(new BuyerPasswordResetMail($url, $storeName, $ttl, self::pagePrefix() === '/account'));
        } catch (Throwable $e) {
            CustomerPasswordResetToken::query()->whereKey($tokenId)->update(['used_at' => now()]);
            Log::warning('buyer password reset mail failed', ['tenant_id' => $tenantId, 'identity_id' => $identity->id, 'exception' => $e::class]);

            return false;
        }

        if ($previousIds !== []) {
            CustomerPasswordResetToken::query()->whereIn('id', $previousIds)->update(['used_at' => now()]);
        }

        return true;
    }

    /**
     * Consume a presented token and set the new password. True only when the token was valid for THIS tenant and THIS channel,
     * unused and unexpired; every other case is a plain false (the caller answers one generic 422).
     */
    public function complete(string $plain, string $newPassword): bool
    {
        $this->requireTenant();
        $channelId = $this->requireChannel();

        if (strlen($plain) !== 64) {
            return false;
        }

        $hash = hash('sha256', $plain);

        return DB::transaction(function () use ($hash, $channelId, $newPassword): bool {
            // identity → token lock order (never token → identity): see BuyerEmailVerificationService::verify (PostgreSQL deadlock note).
            $ownerId = CustomerPasswordResetToken::query()->where('token_hash', $hash)->value('customer_identity_id');
            if (! is_string($ownerId)) {
                return false;
            }

            $identity = CustomerIdentity::query()->whereKey($ownerId)->lockForUpdate()->first();
            if ($identity === null || ! $identity->is_active || $identity->email_verified_at === null) {
                return false;
            }

            $token = CustomerPasswordResetToken::query()
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

            CustomerPasswordResetToken::query()
                ->where('customer_identity_id', $identity->id)->whereNull('used_at')->update(['used_at' => now()]);

            $identity->forceFill(['password' => $newPassword])->save(); // 'hashed' cast
            $identity->tokens()->delete(); // every session, every channel

            return true;
        });
    }

    /**
     * B2C-ACCOUNTS — the e-mailed link lands on the page family that is open on this host: the wholesale `/buyer/*` pages
     * where wholesale is open (unchanged), otherwise the retail `/account/*` pages.
     */
    public static function pagePrefix(): string
    {
        return app(WholesaleBuyerGate::class)->isOpen() ? '/buyer' : '/account';
    }

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
            throw new LogicException('TenantContext is required for buyer password reset.');
        }

        return (string) $this->tenantContext->id();
    }

    private function requireChannel(): string
    {
        if (! $this->storefrontContext->isEstablished()) {
            throw new LogicException('StorefrontContext is required for buyer password reset.');
        }

        return $this->storefrontContext->salesChannelId();
    }
}
