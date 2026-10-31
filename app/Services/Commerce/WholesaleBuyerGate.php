<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Tenancy\StorefrontContext;

/**
 * H6 Final Closure — the ONE definition of "is native wholesale buying open on this host?".
 *
 * Open ⇔ the deployment flag `commerce.wholesale_buyer_enabled` is on AND the host-resolved web channel is itself
 * flagged `wholesale_membership_enabled`. Used by {@see \App\Http\Middleware\EnsureWholesaleBuyerEnabled} (route gate) and
 * by the public storefront config (so the storefront can answer a real 404 for buyer pages on hosts where this is
 * closed). Read-only; the channel comes from the trusted {@see StorefrontContext}, never from client input.
 */
final class WholesaleBuyerGate
{
    public function __construct(private readonly StorefrontContext $context) {}

    public function isOpen(): bool
    {
        if (! (bool) config('commerce.wholesale_buyer_enabled') || ! $this->context->isEstablished()) {
            return false;
        }

        return SalesChannel::query()
            ->whereKey($this->context->salesChannelId())
            ->where('type', SalesChannel::TYPE_WEB)
            ->where('wholesale_membership_enabled', true)
            ->exists();
    }
}
