<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;

/**
 * B2C-DEFAULT — the ONE place that decides the initial `customer_accounts_enabled` of a NEWLY created web channel.
 *
 * New retail stores start with customer accounts ON unless the creator explicitly sent `false`. This is only the
 * persisted per-channel preference: it never bypasses the deployment gate (`commerce.retail_accounts_enabled`), which
 * stays authoritative in {@see RetailAccountGate} — with the gate closed a channel flagged ON is still closed to
 * shoppers. Existing channels are never touched (callers invoke this only on the row they just inserted), the column
 * default stays `false` for every other insert path (CLI ops command, delivery platforms, fixtures), and only a web
 * channel can ever carry the flag (the model guard rejects anything else).
 */
final class NewRetailChannelDefaults
{
    /** `null` = not specified by the creator ⇒ ON; an explicit boolean is respected as sent. */
    public static function initialCustomerAccountsEnabled(?bool $explicit): bool
    {
        return $explicit ?? true;
    }

    /**
     * Creates a web channel with the initial retail-accounts value in a single insert. `customer_accounts_enabled`
     * is deliberately not mass-assignable, so it is set explicitly here and nowhere else.
     *
     * @param  array<string, mixed>  $attributes  fillable channel attributes (tenant_id, slug, name, …)
     */
    public static function createWebChannel(array $attributes, ?bool $customerAccountsEnabled): SalesChannel
    {
        $attributes['type'] = SalesChannel::TYPE_WEB;
        $channel = new SalesChannel($attributes);
        $channel->customer_accounts_enabled = self::initialCustomerAccountsEnabled($customerAccountsEnabled);
        $channel->save();

        return $channel;
    }
}
