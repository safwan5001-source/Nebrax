<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentMethod;
use App\Models\Tenant;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Payment Intent orchestration — COM-MOBILE-PAYMENTS-1 (ADR-04, ADR-09)
 * ═══════════════════════════════════════════════════════════════
 *
 * سلطة إنشاء/انتقال حالة `CommercePaymentIntent` الوحيدة — لا
 * `CommerceCheckoutController`/`CommerceOrderService` يبنيان أو يعدّلان
 * صفّاً منها مباشرة، كلاهما يستدعي هذا فقط. مطابقٌ لنمط `ShippingRateService`/
 * `FulfillmentPolicyService`: خدمةٌ مشتركة واحدة تُستهلك حرفياً من
 * `/commerce/v1` و`/store/v1` (ADR-09 §5) — لا نسخة موازية لأيّ قناة.
 *
 * **لا أثر محاسبي هنا** — `markCollected()` ينقل الحالة فقط في هذا الإصدار.
 * ADR-09 §4 يجعل الربط بـ`PaymentService`/`LedgerService` اختيارياً صراحةً
 * لهذا الإصدار؛ ربطه بسند قبض حقيقي (`Payment`) يحتاج قراراً منفصلاً حول
 * تمثيل عملاء Commerce (`CustomerIdentity` لا `Partner` بالضرورة) في محرك
 * الدفع الحالي (partner-centric) — مسجَّلٌ backlog صراحةً، لا بوابة قرار.
 */
final class CommercePaymentIntentService
{
    /**
     * يُستدعى داخل نفس معاملة `CommerceOrderService::createFromCheckout()`
     * — فشلٌ هنا يُلغي إنشاء الطلب كله (لا طلبٌ بلا Payment Intent مطابق).
     *
     * `$method` يُشتقّ من طريقة التوصيل حصراً — ليس اختياراً مستقلاً في V1
     * (ADR-09 §1: `cod`/`pay_on_pickup` فقط، لا مزوّد).
     *
     * **`$paymentMethodId` اختياري عمداً**: اختيار طريقة دفعٍ محدَّدة
     * (`CommerceCheckoutService::updatePayment()`) خطوةٌ تدريجية اختيارية،
     * لا شرطاً لإتمام الطلب — إلزامها كان سيكسر إتمام كل مستأجرٍ قائم لم
     * يُفعِّل أي طريقة دفعٍ عبر `PaymentMethodChannelAvailabilityService`
     * صراحةً بعد (الافتراض `available_online = false` لكل الطرق المزروعة).
     * غيابه لا يمنع إنشاء Payment Intent — يُترَك `payment_method_id`/
     * `payment_method_name` بلا قيمة، فقط.
     *
     * @throws RuntimeException طريقة توصيل غير مدعومة.
     */
    public function createForOrder(CommerceOrder $order, ?string $paymentMethodId, string $deliveryMethod): CommercePaymentIntent
    {
        $method = match ($deliveryMethod) {
            'standard' => CommercePaymentIntent::METHOD_COD,
            'pickup' => CommercePaymentIntent::METHOD_PAY_ON_PICKUP,
            default => throw new RuntimeException('طريقة توصيل غير مدعومة لتحصيل الدفع.'),
        };

        $paymentMethod = $paymentMethodId === null ? null : $this->resolvePaymentMethod($order->tenant_id, $paymentMethodId);
        $currency = Tenant::findOrFail($order->tenant_id)->currency;

        return CommercePaymentIntent::create([
            'commerce_order_id' => $order->id,
            'payment_method_id' => $paymentMethod?->id,
            'payment_method_name' => $paymentMethod?->name,
            'method' => $method,
            'status' => CommercePaymentIntent::STATUS_AWAITING_COLLECTION,
            'amount_minor' => $order->total,
            'currency' => $currency,
        ]);
    }

    /**
     * تحصيلٌ فعلي (نقدي عند التوصيل أو الاستلام) — انتقالٌ صريح واحد، لا
     * قابل للتراجع. لا أثر محاسبي في هذا الإصدار (راجع توثيق رأس الصنف).
     *
     * @throws RuntimeException الحالة الحالية ليست قابلة للتحصيل.
     */
    public function markCollected(CommercePaymentIntent $intent, ?string $note = null): CommercePaymentIntent
    {
        if ($intent->status !== CommercePaymentIntent::STATUS_AWAITING_COLLECTION) {
            throw new RuntimeException('لا يمكن تحصيل التزام دفع ليس بانتظار التحصيل.');
        }

        $intent->update([
            'status' => CommercePaymentIntent::STATUS_COLLECTED,
            'collected_at' => now(),
            'collection_note' => $note,
        ]);

        return $intent->fresh();
    }

    /**
     * إلغاءٌ صريح — مبلغٌ تحصَّل فعلاً لا يُلغى أبداً (استرجاعٌ منفصل تماماً
     * عن هذا، ADR-04 §14 — Refund != إلغاء التزام دفع لم يُحصَّل).
     *
     * @throws RuntimeException التزام الدفع مُحصَّلٌ بالفعل، أو مُلغىً بالفعل.
     */
    public function cancel(CommercePaymentIntent $intent): CommercePaymentIntent
    {
        if ($intent->isCollected()) {
            throw new RuntimeException('لا يمكن إلغاء التزام دفع مُحصَّل بالفعل.');
        }
        if ($intent->isCancelled()) {
            throw new RuntimeException('التزام الدفع مُلغىً بالفعل.');
        }

        $intent->update([
            'status' => CommercePaymentIntent::STATUS_CANCELLED,
            'cancelled_at' => now(),
        ]);

        return $intent->fresh();
    }

    /** يُستدعى فقط حين اختار العميل/القناة طريقة دفعٍ صراحةً — راجع توثيق `createForOrder()`. */
    private function resolvePaymentMethod(string $tenantId, string $paymentMethodId): PaymentMethod
    {
        $paymentMethod = PaymentMethod::query()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->find($paymentMethodId);

        if ($paymentMethod === null) {
            throw new RuntimeException('طريقة الدفع غير موجودة أو معطّلة.');
        }

        return $paymentMethod;
    }
}
