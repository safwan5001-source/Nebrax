<?php

namespace App\Http\Middleware;

use App\Models\SalesChannel;
use App\Tenancy\StorefrontContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * H6 Batch E — double gate for every store-host wholesale buyer route, evaluated AFTER the host resolver:
 *
 *  1. the deployment flag `commerce.wholesale_buyer_enabled` (default OFF), and
 *  2. the host-resolved channel must itself be wholesale-enabled (`sales_channels.wholesale_membership_enabled`).
 *
 * Either failing is a uniform 404 indistinguishable from "no such route", so an ordinary DTC host never
 * reveals that the capability exists and nothing here can alter DTC behaviour. The channel comes from the
 * trusted {@see StorefrontContext} (Host-derived) — never from client input.
 */
class EnsureWholesaleBuyerEnabled
{
    public function __construct(private StorefrontContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        abort_unless((bool) config('commerce.wholesale_buyer_enabled'), 404);
        abort_unless($this->context->isEstablished(), 404);

        $enabled = SalesChannel::query()
            ->whereKey($this->context->salesChannelId())
            ->where('type', SalesChannel::TYPE_WEB)
            ->where('wholesale_membership_enabled', true)
            ->exists();

        abort_unless($enabled, 404);

        return $next($request);
    }
}
