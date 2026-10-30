<?php

namespace App\Services\Commerce;

use App\Models\PriceList;

/**
 * H6 Batch J — the server-resolved pricing standing of ONE request on ONE wholesale channel.
 *
 * Built only by {@see WholesalePriceAuthority::context()} from the authenticated buyer session, the approved
 * membership and the tenant's own price lists. Nothing in it comes from client input.
 *
 * `eligible = false` means the request is not an approved buyer of this channel: no list is consulted and every
 * product is unavailable. `eligible = true` with both lists `null` means the buyer is approved but neither a valid
 * partner list nor a valid channel list exists ⇒ every product is unavailable (never the base price).
 */
final readonly class WholesalePriceContext
{
    public function __construct(
        public bool $eligible,
        public ?PriceList $partnerList,
        public ?PriceList $channelList,
    ) {}

    public static function ineligible(): self
    {
        return new self(false, null, null);
    }

    /** Lists in precedence order: the buyer's partner list first, then the channel list. @return list<PriceList> */
    public function lists(): array
    {
        return array_values(array_filter([$this->partnerList, $this->channelList]));
    }

    public function hasAnyList(): bool
    {
        return $this->eligible && ($this->partnerList !== null || $this->channelList !== null);
    }
}
