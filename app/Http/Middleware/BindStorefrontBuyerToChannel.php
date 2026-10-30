<?php

namespace App\Http\Middleware;

use App\Models\CustomerIdentity;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * H6 Batch E — runs AFTER {@see AuthenticateCommerceCustomer} (which already proves: Sanctum token, expiry,
 * `CustomerIdentity` tokenable, active, verified contact, same tenant as the host).
 *
 * Adds the missing storefront dimension: the token must carry the channel-binding ability
 * `store-channel:{id}` for the channel this Host resolved to. A token minted for a different host/channel
 * of the same tenant — or a mobile/`customer/v1` token that has no such ability — is rejected, so a session
 * can never be replayed across hosts or inherit privileges from another channel.
 */
class BindStorefrontBuyerToChannel
{
    public const ABILITY_PREFIX = 'store-channel:';

    public function __construct(private StorefrontContext $context) {}

    public static function ability(string $salesChannelId): string
    {
        return self::ABILITY_PREFIX.$salesChannelId;
    }

    public function handle(Request $request, Closure $next): Response
    {
        $identity = $request->user();

        if (! $identity instanceof CustomerIdentity
            || ! $this->context->isEstablished()
            || ! $identity->tokenCan(self::ability($this->context->salesChannelId()))
        ) {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::UNAUTHENTICATED, 'رمز العميل مفقود أو غير صالح.', 401,
            );
        }

        return $next($request);
    }
}
