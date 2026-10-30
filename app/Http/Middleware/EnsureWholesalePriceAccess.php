<?php

namespace App\Http\Middleware;

use App\Models\SalesChannel;
use App\Tenancy\StorefrontContext;
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
 * An unflagged channel (every DTC store) passes through untouched: no auth, no header read, identical
 * responses. The channel comes from the Host-derived {@see StorefrontContext}, never from client input.
 */
class EnsureWholesalePriceAccess
{
    public function __construct(private StorefrontContext $context) {}

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
            ->then(fn (Request $passed): Response => $next($passed));
    }

    private function isWholesaleChannel(string $salesChannelId): bool
    {
        return SalesChannel::query()
            ->whereKey($salesChannelId)
            ->where('wholesale_membership_enabled', true)
            ->exists();
    }
}
