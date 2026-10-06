<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceDeliveryBlockedDate;
use App\Models\CommerceDeliveryScheduleSetting;
use App\Models\CommerceDeliverySlot;
use App\Models\Storefront;
use App\Services\Commerce\CommerceDeliveryScheduleService;
use App\Services\Commerce\MobileSalesChannelResolver;
use App\Services\Commerce\StaleRevisionException;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use PDOException;
use RuntimeException;

/**
 * FLOWERS-H7a / ADR-19 — إدارة سياسة جدولة التسليم لقناة متجر ويب أو لقناة الجوال المعتمدة. `{id}` محدِّد متجر فقط (ولا معرّف لمسار الجوال)؛ الملكية عبر
 * `TenantContext` (404 غير كاشف). كتابةٌ بـ`commerce.manage` ولا مفتاح قناة/مستأجر من العميل — القناة
 * تُشتقّ من المتجر الموثوق (كـ`CommerceGiftSettingsController`).
 */
final class CommerceDeliveryScheduleController extends ApiController
{
    public function show(Request $request, CommerceDeliveryScheduleService $schedule, ?string $id = null): JsonResponse
    {
        $this->denySelfService($request);
        $channelId = $this->ownedChannelId($request, $id);

        return response()->json(['data' => $this->document($schedule, $channelId)]);
    }

    public function updateSettings(Request $request, CommerceDeliveryScheduleService $schedule, ?string $id = null): JsonResponse
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

    public function replaceSlots(Request $request, CommerceDeliveryScheduleService $schedule, ?string $id = null): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'slots' => ['present', 'array', 'max:'.CommerceDeliverySlot::MAX_PER_CHANNEL],
            // اختياري: بصمة النوافذ كما قرأها العميل (`slots_revision`)؛ إن لم تعد تطابق الحالية داخل القفل ⇒ 409 بلا كتابة.
            'expected_revision' => ['sometimes', 'nullable', 'string', 'max:64'],
            // معرّف نافذة موجودة يُحدَّث في مكانه (يُحفظ معرّفها واختيارات Checkout وعدّ السعة)؛ بلا معرّف تُنشأ.
            'slots.*.id' => ['sometimes', 'nullable', 'uuid'],
            'slots.*.method' => ['required', Rule::in(CommerceDeliverySlot::METHODS)],
            'slots.*.label' => ['required', 'string', 'max:80'],
            'slots.*.label_en' => ['sometimes', 'nullable', 'string', 'max:80'],
            'slots.*.start_time' => ['required', 'string', 'regex:'.CommerceDeliveryScheduleSetting::TIME_PATTERN],
            'slots.*.end_time' => ['required', 'string', 'regex:'.CommerceDeliveryScheduleSetting::TIME_PATTERN],
            'slots.*.weekdays' => ['sometimes', 'nullable', 'array', 'max:7'],
            // `distinct` على نمط متداخل (`slots.*.weekdays.*`) يقارن القيم **عبر كل النوافذ** فيرفض نافذتين تشتركان في أي يوم
            // (صباحية/مسائية في الأيام نفسها — الإعداد الأشيع). التفرّد مطلوب داخل النافذة الواحدة فقط، ويُفحص أدناه.
            'slots.*.weekdays.*' => ['integer', 'between:0,6'],
            'slots.*.capacity' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:'.CommerceDeliverySlot::MAX_CAPACITY],
            'slots.*.shipping_zone_id' => ['sometimes', 'nullable', 'uuid'],
            'slots.*.is_active' => ['sometimes', 'boolean'],
        ]);
        foreach (array_values($data['slots']) as $position => $slot) {
            $days = $slot['weekdays'] ?? [];
            if (count($days) !== count(array_unique($days))) {
                throw ValidationException::withMessages(["slots.{$position}.weekdays" => ['أيام الأسبوع في النافذة الواحدة يجب ألّا تتكرّر.']]);
            }
        }
        $channelId = $this->ownedChannelId($request, $id);

        try {
            $schedule->replaceSlots($channelId, array_values($data['slots']), $data['expected_revision'] ?? null);
        } catch (StaleRevisionException $e) {
            abort(409, $e->getMessage());
        } catch (DomainException $e) {
            abort(422, $e->getMessage());
        }

        return response()->json(['data' => $this->document($schedule, $channelId)]);
    }

    public function replaceBlockedDates(Request $request, CommerceDeliveryScheduleService $schedule, ?string $id = null): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'blocked_dates' => ['present', 'array', 'max:'.CommerceDeliveryBlockedDate::MAX_PER_CHANNEL],
            'expected_revision' => ['sometimes', 'nullable', 'string', 'max:64'],
            'blocked_dates.*.date' => ['required', 'string', 'date_format:Y-m-d'],
            'blocked_dates.*.method' => ['sometimes', Rule::in([CommerceDeliveryBlockedDate::METHOD_ALL, ...CommerceDeliverySlot::METHODS])],
            'blocked_dates.*.reason' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);
        $channelId = $this->ownedChannelId($request, $id);

        try {
            $schedule->replaceBlockedDates($channelId, array_values($data['blocked_dates']), $data['expected_revision'] ?? null);
        } catch (StaleRevisionException $e) {
            abort(409, $e->getMessage());
        } catch (DomainException $e) {
            abort(422, $e->getMessage());
        }

        return response()->json(['data' => $this->document($schedule, $channelId)]);
    }

    /** @return array<string, mixed> */
    private function document(CommerceDeliveryScheduleService $schedule, string $channelId): array
    {
        $slots = $schedule->slots($channelId); // قراءة واحدة: القائمة وبصمتها من اللقطة نفسها
        $blocked = $schedule->blockedDates($channelId);

        return [
            'settings' => $schedule->settings($channelId),
            'slots' => $slots,
            'slots_revision' => $schedule->revisionFor($slots),
            'blocked_dates' => $blocked,
            'blocked_dates_revision' => $schedule->blockedRevisionFor($blocked),
        ];
    }

    /**
     * قناة السياسة: لمتجر ويب (`storefronts/{id}`: القناة تُشتقّ من المتجر الموثوق) أو لقناة الجوال المعتمدة للمستأجر
     * (`mobile-channel`: بلا معرّف — هي نفسها التي تخدمها `/commerce/v1` عبر `MobileSalesChannelResolver::
     * canonicalForTenant`، فلا تُكتب سياسة لقناةٍ لا يخدمها أي طلب عام). بنطاق المستأجر و404 غير كاشف؛ لا مفتاح
     * قناة يُقبل من العميل أصلاً.
     */
    private function ownedChannelId(Request $request, ?string $id): string
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        if (($request->route()?->defaults['channel'] ?? null) === 'mobile') {
            $channel = app(MobileSalesChannelResolver::class)->canonicalForTenant($tenantId);
            abort_if($channel === null, 404, 'لا توجد قناة جوال نشطة.');

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
