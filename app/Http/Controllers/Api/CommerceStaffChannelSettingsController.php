<?php

namespace App\Http\Controllers\Api;

use App\Models\PriceList;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Services\Commerce\SalesChannelSettingsException;
use App\Services\Commerce\SalesChannelSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * H6 Batch F — staff pricing settings of a web sales channel. Routes carry `commerce.channel_settings.manage`
 * (owner/admin via `*` only — never in MATRIX, never granted to a stored role) plus
 * `EnsureApplicationActive:commerce.storefront`. The tenant is the authenticated staff member's; the body
 * can never name one (`tenant_id` is rejected). Channel and price list are resolved under TenantScope.
 *
 * This endpoint changes configuration only: it does not enable wholesale in any deployment (the
 * `commerce.wholesale_buyer_enabled` gate is separate and stays off) and it never touches prices, orders or
 * accounting. The audit trail lives in {@see SalesChannelSettingsService}.
 */
class CommerceStaffChannelSettingsController extends ApiController
{
    public function show(Request $request, string $id): JsonResponse
    {
        $channel = SalesChannel::query()->where('type', SalesChannel::TYPE_WEB)->find($id);
        abort_if($channel === null, 404, 'القناة غير موجودة.');

        return response()->json(['data' => $this->serialize($channel, withHistory: true)]);
    }

    public function update(Request $request, string $id, SalesChannelSettingsService $settings): JsonResponse
    {
        $data = $request->validate([
            'tenant_id' => ['prohibited'],
            SalesChannelSettingsService::KEY_PRICE_LIST => ['sometimes', 'nullable', 'uuid'],
            SalesChannelSettingsService::KEY_WHOLESALE => ['sometimes', 'boolean'],
        ]);
        unset($data['tenant_id']);

        if ($data === []) {
            return response()->json(['message' => 'No setting supplied.', 'reason' => 'no_changes_supplied'], 422);
        }

        try {
            $channel = $settings->update($id, $data, $request->user());
        } catch (SalesChannelSettingsException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $e->status);
        }

        return response()->json(['data' => $this->serialize($channel, withHistory: true)]);
    }

    private function serialize(SalesChannel $channel, bool $withHistory): array
    {
        $list = $channel->default_price_list_id === null
            ? null
            : PriceList::query()->whereKey($channel->default_price_list_id)->first();

        $payload = [
            'id' => $channel->id,
            'name' => $channel->name,
            'type' => $channel->type,
            'default_price_list' => $list === null ? null : ['id' => $list->id, 'name' => $list->name, 'is_active' => (bool) $list->is_active],
            'wholesale_membership_enabled' => (bool) $channel->wholesale_membership_enabled,
            // Deployment master switch, read-only here: the channel flag alone never enables wholesale.
            'wholesale_deployment_enabled' => (bool) config('commerce.wholesale_buyer_enabled'),
        ];

        if ($withHistory) {
            $payload['recent_changes'] = SalesChannelSettingEvent::query()
                ->where('sales_channel_id', $channel->id)
                ->with('actor:id,name')
                ->orderByDesc('created_at')->orderByDesc('id')
                ->limit(10)->get()
                ->map(fn (SalesChannelSettingEvent $e): array => [
                    'at' => $e->created_at?->toIso8601String(),
                    'actor' => $e->actor === null ? null : ['id' => $e->actor->id, 'name' => $e->actor->name],
                    'changes' => $e->changes,
                ])->all();
        }

        return $payload;
    }
}
