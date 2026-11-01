<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Tenancy\StorefrontContext;

/**
 * B2C-ACCOUNTS — the ONE definition of "are native retail shopper accounts open on this host?".
 *
 * Open ⇔ the deployment flag `commerce.retail_accounts_enabled` is on AND the Host-resolved web channel is itself
 * flagged `customer_accounts_enabled`. Same shape as {@see WholesaleBuyerGate}: read-only, the channel comes from the
 * trusted {@see StorefrontContext} (Host-derived), never from client input. Closed ⇒ every account route answers the
 * uniform 404 and guest browsing / cart / checkout are untouched.
 */
final class RetailAccountGate
{
    public function __construct(private readonly StorefrontContext $context) {}

    public function isOpen(): bool
    {
        if (! (bool) config('commerce.retail_accounts_enabled') || ! $this->context->isEstablished()) {
            return false;
        }

        return SalesChannel::query()
            ->whereKey($this->context->salesChannelId())
            ->where('type', SalesChannel::TYPE_WEB)
            ->where('customer_accounts_enabled', true)
            ->exists();
    }
}
