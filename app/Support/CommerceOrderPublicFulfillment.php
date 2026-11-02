<?php

namespace App\Support;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderFulfillment;

/**
 * الكتلة العامة لتنفيذ الطلب (COPS-H2-4، D-H2-13/14) — إسقاط **نقيّ للقراءة** من حقائق مخزَّنة، بقائمة بيضاء حرفية.
 *
 * ```
 * fulfillment: { type, stage, stages:[{key, at}], tracking:{carrier, number, url}|null, pickup:{ready_at}|null }
 * ```
 *
 * - **تغيب تماماً** (لا مفتاح) حين لا صف تنفيذ، وللطلب **الملغى** (الإلغاء يطغى، O3c): الاستجابات القديمة بايتاً ببايت.
 * - المراحل العامة: `placed` · `accepted` (يدوي فقط) · `preparing` · `ready` · `out_for_delivery` · `delivered`/`picked_up`.
 *   `delivery_failed` و`returned_to_store` ⇒ المرحلة العامة `delivery_attempt_failed` **بلا سبب ولا عدد محاولات** (لا إخفاء يضلّل العميل، ولا كشف داخلي).
 * - `tracking` للناقل وبعد الإرسال فقط؛ `pickup.ready_at` للاستلام وبعد الجاهزية فقط.
 * - **ممنوع هنا بالتصميم:** اسم/هاتف الساعي، الموظف، المخزن، الملاحظات، سبب الفشل، النسخة، عدد المحاولات (يحرسها اختبار قائمة بيضاء).
 * - لا يقرأ بوابة التنفيذ (AR-3): إغلاقها لا يُخفي حقيقة مخزَّنة. لا كتابة ولا حدث ولا أثر مالي/مخزني.
 */
final class CommerceOrderPublicFulfillment
{
    public const STAGE_ATTEMPT_FAILED = 'delivery_attempt_failed';

    /** @return array<string, mixed> `['fulfillment' => …]` أو `[]` */
    public static function block(CommerceOrder $order): array
    {
        if ($order->isCancelled()) {
            return [];
        }

        $row = $order->fulfillment;
        if ($row === null) {
            return [];
        }

        $stage = match ($row->status) {
            CommerceOrderFulfillment::DELIVERY_FAILED, CommerceOrderFulfillment::RETURNED_TO_STORE => self::STAGE_ATTEMPT_FAILED,
            default => $row->status,
        };

        $stages = [['key' => 'placed', 'at' => self::iso($order->confirmed_at ?? $order->created_at)]];
        if ($order->acceptance_mode === CommerceOrder::ACCEPTANCE_MANUAL && $order->accepted_at !== null) {
            $stages[] = ['key' => 'accepted', 'at' => self::iso($order->accepted_at)];
        }
        if ($row->preparing_at !== null) {
            $stages[] = ['key' => 'preparing', 'at' => self::iso($row->preparing_at)];
        }
        if ($row->ready_at !== null) {
            $stages[] = ['key' => 'ready', 'at' => self::iso($row->ready_at)];
        }
        if ($row->first_dispatched_at !== null) {
            $stages[] = ['key' => 'out_for_delivery', 'at' => self::iso($row->last_dispatched_at ?? $row->first_dispatched_at)];
        }
        match ($row->status) {
            CommerceOrderFulfillment::DELIVERED => $stages[] = ['key' => 'delivered', 'at' => self::iso($row->delivered_at)],
            CommerceOrderFulfillment::PICKED_UP => $stages[] = ['key' => 'picked_up', 'at' => self::iso($row->picked_up_at)],
            CommerceOrderFulfillment::DELIVERY_FAILED, CommerceOrderFulfillment::RETURNED_TO_STORE => $stages[] = ['key' => self::STAGE_ATTEMPT_FAILED, 'at' => self::iso($row->last_failed_at)],
            default => null,
        };

        $tracking = $row->type === CommerceOrderFulfillment::TYPE_CARRIER && $row->first_dispatched_at !== null
            ? ['carrier' => $row->carrier_name, 'number' => $row->tracking_number, 'url' => $row->tracking_url]
            : null;

        $pickup = $row->type === CommerceOrderFulfillment::TYPE_PICKUP && $row->ready_at !== null
            ? ['ready_at' => self::iso($row->ready_at)]
            : null;

        return ['fulfillment' => [
            'type' => $row->type,
            'stage' => $stage,
            'stages' => $stages,
            'tracking' => $tracking,
            'pickup' => $pickup,
        ]];
    }

    private static function iso(?\DateTimeInterface $at): ?string
    {
        return $at === null ? null : \Carbon\CarbonImmutable::instance($at)->toIso8601String();
    }
}
