<?php

namespace App\Http\Middleware;

use App\Models\CustomerIdentity;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * COM-MOBILE-AUTH-1 — resolves the Commerce customer's own Sanctum token
 * from `X-Customer-Token`, never `Authorization` (already reserved on
 * `/commerce/v1` for the ApiClient/store bearer resolved earlier in the
 * chain by `AuthenticateApiClient` — same header-separation precedent as
 * `CommerceCartService`'s `X-Cart-Token`). Runs *after* the full existing
 * `/commerce/v1` chain (`PublicApiRequestAudit`/`EnforcePublicApiRateLimit`
 * both still read `$request->user()` expecting the `ApiClient`), then swaps
 * the user resolver to the authenticated `CustomerIdentity` so the existing,
 * unmodified `EstablishCustomerContext` middleware can run immediately after
 * this one — exactly as it already does on `/customer/v1`.
 *
 * Deliberately does not reuse `EnsureCustomerPrincipal`: that middleware
 * requires `email_verified_at` specifically, but a phone-OTP-verified
 * identity may have no email at all. The condition here is "some verified
 * contact method", not "verified email".
 */
class AuthenticateCommerceCustomer
{
    public const TOKEN_HEADER = 'X-Customer-Token';

    public function __construct(private TenantContext $tenantContext) {}

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->header(self::TOKEN_HEADER);

        if (! is_string($token) || $token === '') {
            return $this->unauthenticated($request);
        }

        $accessToken = PersonalAccessToken::findToken($token);

        if (
            $accessToken === null
            || $accessToken->tokenable_type !== CustomerIdentity::class
            || ($accessToken->expires_at !== null && $accessToken->expires_at->isPast())
        ) {
            return $this->unauthenticated($request);
        }

        $identity = $accessToken->tokenable;

        if (
            ! $identity instanceof CustomerIdentity
            || ! $identity->is_active
            || ($identity->email_verified_at === null && $identity->phone_verified_at === null)
            || ! $this->tenantContext->has()
            || $identity->tenant_id !== $this->tenantContext->id()
        ) {
            return $this->unauthenticated($request);
        }

        $identity->withAccessToken($accessToken);

        if (! $identity->tokenCan('customer:access')) {
            return $this->unauthenticated($request);
        }

        $accessToken->forceFill(['last_used_at' => now()])->save();
        $request->setUserResolver(static fn () => $identity);

        return $next($request);
    }

    private function unauthenticated(Request $request): Response
    {
        return PublicApiResponse::error(
            $request, PublicApiErrorCode::UNAUTHENTICATED, 'رمز العميل مفقود أو غير صالح.', 401,
        );
    }
}
