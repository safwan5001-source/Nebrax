<?php

namespace App\Http\Middleware;

use App\Models\CustomerIdentity;
use App\Models\SalesChannel;
use App\Services\Commerce\RetailAccountGate;
use App\Tenancy\CustomerContext;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Pipeline\Pipeline;
use Symfony\Component\HttpFoundation\Response;

/**
 * B2C-ACCOUNTS — OPTIONAL shopper identity on the guest cart / checkout routes of a retail-accounts host.
 *
 * A signed-in shopper's cart and order should belong to their account (so the order appears in their history with no
 * extra step); a guest must keep shopping exactly as before. So this never blocks: when the host has retail accounts
 * open AND a customer token is presented AND it fully verifies (token, expiry, active, verified contact, same tenant,
 * minted for THIS host's channel — the very same {@see AuthenticateCommerceCustomer} + {@see BindStorefrontBuyerToChannel}
 * chain every account route uses), the identity becomes the request's trusted {@see CustomerContext} owner. ANY failure
 * (no/expired/revoked/foreign-channel token) continues as a plain guest request — the existing cart/checkout machinery
 * then behaves byte-for-byte as it did before this feature.
 *
 * Inert (a straight pass-through) on a host without retail accounts and on any wholesale-flagged channel, where
 * {@see EnsureWholesalePriceAccess} remains the only authority — wholesale authentication and pricing are untouched.
 * The partner link is deliberately NOT set: no customer-specific pricing is introduced.
 */
class EstablishRetailCustomerIfPresent
{
    public function __construct(
        private RetailAccountGate $gate,
        private StorefrontContext $storefront,
        private TenantContext $tenant,
        private CustomerContext $customerContext,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->header(AuthenticateCommerceCustomer::TOKEN_HEADER);

        if (! is_string($token) || $token === '' || ! $this->gate->isOpen() || $this->isWholesaleChannel()) {
            return $next($request);
        }

        $reached = false;

        $response = (new Pipeline(app()))
            ->send($request)
            ->through([AuthenticateCommerceCustomer::class, BindStorefrontBuyerToChannel::class])
            ->then(function (Request $passed) use ($next, &$reached): Response {
                $reached = true;
                $identity = $passed->user();
                $established = $identity instanceof CustomerIdentity && $this->tenant->has();
                if ($established) {
                    $this->customerContext->set((string) $this->tenant->id(), $identity->id, null);
                }

                try {
                    return $next($passed);
                } finally {
                    if ($established) {
                        $this->customerContext->forget();
                    }
                }
            });

        // The token did not verify: shop as a guest, as if no token had been sent.
        return $reached ? $response : $next($request);
    }

    private function isWholesaleChannel(): bool
    {
        return SalesChannel::query()
            ->whereKey($this->storefront->salesChannelId())
            ->where('wholesale_membership_enabled', true)
            ->exists();
    }
}
