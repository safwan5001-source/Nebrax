<?php

namespace App\Http\Middleware;

use App\Models\CustomerIdentity;
use App\Models\SalesChannel;
use App\Tenancy\CustomerContext;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Pipeline\Pipeline;
use Symfony\Component\HttpFoundation\Response;

/**
 * H6 Batch F — price-visibility gate for every price-bearing store route (products, offers, cart, checkout),
 * evaluated AFTER the host resolver.
 *
 * A channel that staff flagged `wholesale_membership_enabled` is a wholesale channel: its prices are not
 * public. Authentication alone grants nothing — the request must carry a valid buyer session bound to THIS
 * host-resolved channel ({@see AuthenticateCommerceCustomer} + {@see BindStorefrontBuyerToChannel}) AND an
 * `approved` membership ({@see EnsureApprovedWholesaleBuyer}, read fresh on every request).
 *
 * Fail-closed ordering for a flagged channel:
 *  1. deployment flag `commerce.wholesale_buyer_enabled` off  → uniform 404 (the channel is dark; there is
 *     no fallback to retail prices, another channel or another tenant);
 *  2. otherwise the three buyer checks above (401 / 403 as defined by those middleware).
 *
 * After the three checks pass, the buyer is established as the request's `CustomerContext` owner (attribution of carts
 * and orders). An unflagged channel (every DTC store) passes through untouched: no auth, no header read, identical
 * responses. The channel comes from the Host-derived {@see StorefrontContext}, never from client input.
 */
class EnsureWholesalePriceAccess
{
    public function __construct(
        private StorefrontContext $context,
        private TenantContext $tenantContext,
        private CustomerContext $customerContext,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->context->isEstablished() || ! $this->isWholesaleChannel($this->context->salesChannelId())) {
            return $next($request);
        }

        abort_unless((bool) config('commerce.wholesale_buyer_enabled'), 404);

        return (new Pipeline(app()))
            ->send($request)
            ->through([
                AuthenticateCommerceCustomer::class,
                BindStorefrontBuyerToChannel::class,
                EnsureApprovedWholesaleBuyer::class,
            ])
            ->then(function (Request $passed) use ($next): Response {
                // H6 Batch H — the approved buyer becomes the request's trusted owner. The identity comes from the
                // verified token (never from input) and is bound to THIS host's tenant/channel by the middleware above;
                // from here the existing cart/checkout machinery owns the cart and stamps the order with it. The
                // linked partner is deliberately NOT set: buyer-specific pricing is a separate, undecided contract.
                $identity = $passed->user();
                $established = $identity instanceof CustomerIdentity && $this->tenantContext->has();
                if ($established) {
                    $this->customerContext->set((string) $this->tenantContext->id(), $identity->id, null);
                }

                try {
                    return $next($passed);
                } finally {
                    if ($established) {
                        $this->customerContext->forget();
                    }
                }
            });
    }

    private function isWholesaleChannel(string $salesChannelId): bool
    {
        return SalesChannel::query()
            ->whereKey($salesChannelId)
            ->where('wholesale_membership_enabled', true)
            ->exists();
    }
}
