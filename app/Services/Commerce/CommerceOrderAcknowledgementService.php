<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderAcknowledgement;
use App\Models\CommerceOrderEvent;
use App\Models\CommercePaymentIntent;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * إقرار تنبيه الطلب لكل طلب — **الكاتب الوحيد** لـ`commerce_order_acknowledgements` (COPS-H3-4، R-10 المعتمد، ADR-30 §4).
 *
 * الإقرار فعل مشاهدة (`commerce.orders.view` على المسار) لا انتقال: **لا يغيّر حالة الطلب ولا الدفع ولا القبول ولا التنفيذ، ولا يُخرج الطلب من قوائم العمل/`attention`**
 * (يُسكت التنبيه فقط: `attention` يعلن `alert.pending=false`). لا قيد ولا مخزون ولا حجز.
 *
 * **الأقفال (ADR-28 §1.3):** النية ← الطلب (يسلسلان مع الإلغاء/الالتقاط/القبول) ثم الكتابة، و**الحدث `order.acknowledged` آخر كتابة** (رأس التغذية آخر قفل). لا قفل جديد، لا شبكة.
 * **idempotent بالحالة:** طلب مُقَرّ سابقاً ⇒ يُعاد صفّه بلا حدث ولا تغيير للفاعل/الوقت (حتى لو أُلغي الطلب بعده). الإقرار الأول يشترط طلباً مؤكَّداً غير ملغى ودفعه جاهزاً (R-5).
 * يُعاد فحص نطاق المخازن تحت القفل (`CommerceOrderWarehouseScope::assertVisible`).
 */
final class CommerceOrderAcknowledgementService
{
    public function __construct(private readonly CommerceOrderEventRecorder $events) {}

    /** @return array{acknowledgement: CommerceOrderAcknowledgement, created: bool} */
    public function acknowledge(CommerceOrder $order, User $actor): array
    {
        return DB::transaction(function () use ($order, $actor): array {
            $intent = CommercePaymentIntent::query()->where('commerce_order_id', $order->id)->lockForUpdate()->first();
            $locked = CommerceOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            CommerceOrderWarehouseScope::assertVisible($locked, $actor);

            $existing = CommerceOrderAcknowledgement::query()->where('commerce_order_id', $locked->id)->first();
            if ($existing !== null) {
                return ['acknowledgement' => $existing, 'created' => false];
            }

            if ($locked->isCancelled()) {
                throw new CommerceOrderAcknowledgementException(CommerceOrderAcknowledgementException::ALREADY_CANCELLED, 'أُلغي هذا الطلب.');
            }
            if (! $locked->isConfirmed()) {
                throw new CommerceOrderAcknowledgementException(CommerceOrderAcknowledgementException::NOT_CONFIRMED, 'لا يمكن إقرار طلب غير مؤكَّد.', 422);
            }
            if ($intent === null || ! in_array($intent->status, CommerceOrderAttentionQuery::PAYMENT_READY, true)) {
                throw new CommerceOrderAcknowledgementException(CommerceOrderAcknowledgementException::NOT_ALERTABLE, 'الطلب غير جاهز للتنبيه بعد (الدفع غير مؤكَّد).');
            }

            $ack = new CommerceOrderAcknowledgement;
            $ack->forceFill(['commerce_order_id' => $locked->id, 'acknowledged_by_user_id' => $actor->id, 'acknowledged_at' => now('UTC')])->save();

            // آخر كتابة في المعاملة — رأس التغذية آخر قفل (الفرع idempotent أعلاه لا يصل هنا).
            $this->events->append($locked, CommerceOrderEvent::ORDER_ACKNOWLEDGED, CommerceOrderEvent::ACTOR_USER, (string) $actor->id);

            return ['acknowledgement' => $ack->fresh(), 'created' => true];
        });
    }
}
