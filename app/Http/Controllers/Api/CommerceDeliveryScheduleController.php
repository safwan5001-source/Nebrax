<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceDeliveryBlockedDate;
use App\Models\CommerceDeliveryScheduleSetting;
use App\Models\CommerceDeliverySlot;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Services\Commerce\CommerceDeliveryScheduleService;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use PDOException;
use RuntimeException;

/**
 * FLOWERS-H7a / ADR-19 — إدارة سياسة جدولة التسليم لقناة متجر ويب أو قناة جوال. `{id}` محدِّد متجر (أو قناة جوال) فقط؛ الملكية عبر
 * `TenantContext` (404 غير كاشف). كتابةٌ بـ`commerce.manage` ولا مفتاح قناة/مستأجر من العميل — القناة
 * تُشتقّ من المتجر الموثوق (كـ`CommerceGiftSettingsController`).
 */
final class CommerceDeliveryScheduleController extends ApiController
{
    public function show(Request $request, CommerceDeliveryScheduleService $schedule, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $channelId = $this->ownedChannelId($request, $id);

        return response()->json(['data' => $this->document($schedule, $channelId)]);
    }

    public function updateSettings(Request $request, CommerceDeliveryScheduleService $schedule, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'is_enabled' => ['sometimes', 'boolean'],
            'is_required' => ['sometimes', 'boolean'],
            'timezone' => ['sometimes', 'nullable', 'string', 'max:64', Rule::in(\DateTimeZone::listIdentifiers())],
            'lead_time_minutes' => ['sometimes', 'integer', 'min:0', 'max:'.CommerceDeliveryScheduleSetting::MAX_LEAD_TIME_MINUTES],
            'cutoff_time' => ['sometimes', 'nullable', 'string', 'regex:'.CommerceDeliveryScheduleSetting::TIME_PATTERN],
            'max_days_ahead' => ['sometimes', 'integer', 'min:1', 'max:'.CommerceDeliveryScheduleSetting::MAX_DAYS_AHEAD],
        ]);
        $channelId = $this->ownedChannelId($request, $id);

        try {
            $schedule->saveSettings($channelId, $data);
        } catch (PDOException $e) {
            throw $e;
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        return response()->json(['data' => $this->document($schedule, $channelId)]);
    }

    public function replaceSlots(Request $request, CommerceDeliveryScheduleService $schedule, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'slots' => ['present', 'array', 'max:'.CommerceDeliverySlot::MAX_PER_CHANNEL],
            'slots.*.method' => ['required', Rule::in(CommerceDeliverySlot::METHODS)],
            'slots.*.label' => ['required', 'string', 'max:80'],
            'slots.*.label_en' => ['sometimes', 'nullable', 'string', 'max:80'],
            'slots.*.start_time' => ['required', 'string', 'regex:'.CommerceDeliveryScheduleSetting::TIME_PATTERN],
            'slots.*.end_time' => ['required', 'string', 'regex:'.CommerceDeliveryScheduleSetting::TIME_PATTERN],
            'slots.*.weekdays' => ['sometimes', 'nullable', 'array', 'max:7'],
            'slots.*.weekdays.*' => ['integer', 'between:0,6', 'distinct'],
            'slots.*.capacity' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:'.CommerceDeliverySlot::MAX_CAPACITY],
            'slots.*.shipping_zone_id' => ['sometimes', 'nullable', 'uuid'],
            'slots.*.is_active' => ['sometimes', 'boolean'],
        ]);
        $channelId = $this->ownedChannelId($request, $id);

        try {
            $schedule->replaceSlots($channelId, array_values($data['slots']));
        } catch (DomainException $e) {
            abort(422, $e->getMessage());
        }

        return response()->json(['data' => $this->document($schedule, $channelId)]);
    }

    public function replaceBlockedDates(Request $request, CommerceDeliveryScheduleService $schedule, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'blocked_dates' => ['present', 'array', 'max:'.CommerceDeliveryBlockedDate::MAX_PER_CHANNEL],
            'blocked_dates.*.date' => ['required', 'string', 'date_format:Y-m-d'],
            'blocked_dates.*.method' => ['sometimes', Rule::in([CommerceDeliveryBlockedDate::METHOD_ALL, ...CommerceDeliverySlot::METHODS])],
            'blocked_dates.*.reason' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);
        $channelId = $this->ownedChannelId($request, $id);

        try {
            $schedule->replaceBlockedDates($channelId, array_values($data['blocked_dates']));
        } catch (DomainException $e) {
            abort(422, $e->getMessage());
        }

        return response()->json(['data' => $this->document($schedule, $channelId)]);
    }

    /** @return array<string, mixed> */
    private function document(CommerceDeliveryScheduleService $schedule, string $channelId): array
    {
        return [
            'settings' => $schedule->settings($channelId),
            'slots' => $schedule->slots($channelId),
            'blocked_dates' => $schedule->blockedDates($channelId),
        ];
    }

    /**
     * قناة السياسة: لمتجر ويب (`storefronts/{id}`: القناة تُشتقّ من المتجر الموثوق) أو لقناة جوال
     * (`mobile-channels/{id}`: معرّف `SalesChannel` من نوع mobile ونشط). كلاهما بنطاق المستأجر و404 غير كاشف؛
     * لا مفتاح قناة يُقبل من الجسم، فلا يمكن توجيه السياسة إلى قناة مستأجر آخر ولا إلى نوع قناة غير مقصود.
     */
    private function ownedChannelId(Request $request, string $id): string
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        if (($request->route()?->defaults['channel'] ?? null) === 'mobile') {
            $channel = SalesChannel::query()->whereKey($id)->where('type', SalesChannel::TYPE_MOBILE)->where('is_active', true)->first();
            abort_if($channel === null || $channel->tenant_id !== $tenantId, 404, 'قناة الجوال غير موجودة.');

            return $channel->id;
        }

        $storefront = Storefront::query()->find($id);
        abort_if($storefront === null || $storefront->tenant_id !== $tenantId, 404, 'المتجر غير موجود.');

        return $storefront->sales_channel_id;
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
