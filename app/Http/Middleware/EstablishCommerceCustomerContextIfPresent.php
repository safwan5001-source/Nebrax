<?php

namespace App\Http\Middleware;

use App\Models\CustomerIdentity;
use App\Models\CustomerPartnerLink;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * COM-MOBILE-CART-IDENTITY-1 (ADR-07) — optional customer-context
 * establishment for routes that must keep working for guests (cart,
 * checkout): an absent `X-Customer-Token` continues as guest, completely
 * unchanged from today. A **present** but invalid/expired/wrong-type/
 * wrong-tenant/inactive-identity token still fails closed (401) — a broken
 * credential is never silently downgraded to "guest" (same fail-closed
 * philosophy as `AuthenticateApiClient`); a customer whose own session
 * expired must see that, not silently lose their identity mid-cart.
 *
 * Deliberately not composed with the required `AuthenticateCommerceCustomer`
 * (`/commerce/v1` `auth/logout`/`me`, COM-MOBILE-AUTH-1): that middleware
 * always 401s on a missing header, which guest cart/checkout routes must
 * never do. The token-resolution logic below is intentionally duplicated
 * from it rather than shared, matching the same "avoid coupling across
 * trust-boundary-adjacent concerns" reasoning already used twice in this
 * codebase (`AuthenticateCommerceCustomer`'s own docblock) — the two
 * middleware protect different route shapes and must be free to diverge.
 *
 * Establishes `CustomerContext` directly (the same short partner-link
 * lookup `EstablishCustomerContext` already runs) rather than composing
 * with that middleware, because `EstablishCustomerContext` unconditionally
 * aborts (403) when the principal is not a `CustomerIdentity` — exactly the
 * guest case this middleware must tolerate silently.
 *
 * Restores the original resolver (the `ApiClient` `AuthenticateApiClient`
 * already resolved) after `$next()` returns, for the same
 * `PublicApiRequestAudit`/`EnforcePublicApiRateLimit` reason
 * `AuthenticateCommerceCustomer` documents.
 */
class EstablishCommerceCustomerContextIfPresent
{
    public const TOKEN_HEADER = 'X-Customer-Token';

    public function __construct(
        private TenantContext $tenantContext,
        private CustomerContext $customerContext,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $this->customerContext->forget();

        $token = $request->header(self::TOKEN_HEADER);

        if (! is_string($token) || $token === '') {
            return $next($request);
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

        $partnerId = CustomerPartnerLink::query()
            ->where('customer_identity_id', $identity->id)
            ->where('status', 'active')
            ->whereHas('partner', fn ($query) => $query
                ->where('is_active', true)
                ->whereIn('type', ['customer', 'both']))
            ->value('partner_id');

        $this->customerContext->set($this->tenantContext->id(), $identity->id, $partnerId);
        $accessToken->forceFill(['last_used_at' => now()])->save();

        $originalUser = $request->user();
        $request->setUserResolver(static fn () => $identity);

        try {
            return $next($request);
        } finally {
            $this->customerContext->forget();
            $request->setUserResolver(static fn () => $originalUser);
        }
    }

    private function unauthenticated(Request $request): Response
    {
        return PublicApiResponse::error(
            $request, PublicApiErrorCode::UNAUTHENTICATED, 'رمز العميل غير صالح.', 401,
        );
    }
}
