<?php

namespace App\Services\Commerce;

use App\Models\PriceList;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * H6 Batch F — the single write path for a web sales channel's pricing settings:
 *
 *  - `default_price_list_id` (assign an existing price list / clear it), and
 *  - `wholesale_membership_enabled` (mark the channel as requiring an approved wholesale membership).
 *
 * Nothing here activates anything by itself: the deployment gate `commerce.wholesale_buyer_enabled` stays
 * the master switch, and enabling the membership flag is REFUSED while that gate is off (otherwise the
 * price-visibility gate would turn the whole storefront dark). Both lookups run under TenantScope, so a
 * foreign/unknown channel or price list is indistinguishable from a missing one. The channel row is locked
 * for the duration of the change so two concurrent edits serialise and each audit event records the true
 * before/after. Every effective change appends one immutable {@see SalesChannelSettingEvent}; a request that
 * changes nothing writes nothing.
 *
 * Currency: price lists carry no currency of their own — the tenant is single-currency
 * (`CommercePriceResolver` reads `Tenant.currency`) — so same-tenant + active IS the currency-compatibility
 * rule; it cannot be violated per list.
 */
class SalesChannelSettingsService
{
    public const KEY_PRICE_LIST = 'default_price_list_id';

    public const KEY_WHOLESALE = 'wholesale_membership_enabled';

    public function __construct(private TenantContext $tenantContext) {}

    /**
     * @param  array<string, mixed>  $changes  subset of the two setting keys
     *
     * @throws SalesChannelSettingsException
     */
    public function update(string $channelId, array $changes, User $actor): SalesChannel
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required to change channel settings.');
        }
        if ($actor->tenant_id !== $this->tenantContext->id()) {
            throw new SalesChannelSettingsException('not_found', 'Channel not found.', 404);
        }

        return DB::transaction(function () use ($channelId, $changes, $actor): SalesChannel {
            $channel = SalesChannel::query()->lockForUpdate()->find($channelId);
            if ($channel === null) {
                throw new SalesChannelSettingsException('not_found', 'Channel not found.', 404);
            }
            if ($channel->type !== SalesChannel::TYPE_WEB) {
                throw new SalesChannelSettingsException('channel_not_web', 'Pricing settings apply to web channels only.');
            }

            $diff = [];

            if (array_key_exists(self::KEY_PRICE_LIST, $changes)) {
                $to = $changes[self::KEY_PRICE_LIST];
                if ($to !== null) {
                    // TenantScope + soft-delete scope: foreign, deleted and unknown ids all read as "not found".
                    $list = PriceList::query()->whereKey($to)->first();
                    if ($list === null) {
                        throw new SalesChannelSettingsException('price_list_not_found', 'Price list not found.');
                    }
                    if (! $list->is_active) {
                        throw new SalesChannelSettingsException('price_list_inactive', 'Price list must be active.');
                    }
                }
                if ($to !== $channel->default_price_list_id) {
                    $diff[self::KEY_PRICE_LIST] = ['from' => $channel->default_price_list_id, 'to' => $to];
                    $channel->default_price_list_id = $to;
                }
            }

            if (array_key_exists(self::KEY_WHOLESALE, $changes)) {
                $to = (bool) $changes[self::KEY_WHOLESALE];
                if ($to && ! $channel->wholesale_membership_enabled && ! (bool) config('commerce.wholesale_buyer_enabled')) {
                    throw new SalesChannelSettingsException(
                        'wholesale_deployment_disabled',
                        'Wholesale is not enabled for this deployment; the channel flag cannot be turned on.',
                        409,
                    );
                }
                if ($to !== (bool) $channel->wholesale_membership_enabled) {
                    $diff[self::KEY_WHOLESALE] = ['from' => (bool) $channel->wholesale_membership_enabled, 'to' => $to];
                    $channel->wholesale_membership_enabled = $to;
                }
            }

            if ($diff === []) {
                return $channel;
            }

            $channel->save();

            SalesChannelSettingEvent::create([
                'tenant_id' => $this->tenantContext->id(),
                'sales_channel_id' => $channel->id,
                'actor_user_id' => $actor->id,
                'changes' => $diff,
            ]);

            return $channel;
        });
    }
}
