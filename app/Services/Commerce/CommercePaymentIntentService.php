<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentMethod;
use App\Models\Tenant;
use App\Services\PaymentMethodChannelAvailabilityService;
use Illuminate\Support\Facades\DB;
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
    public function __construct(
        private readonly PaymentMethodChannelAvailabilityService $paymentAvailability,
        private readonly CommerceOnlinePaymentService $online,
        private readonly CustomerPartnerResolver $partners,
    ) {}

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

        $paymentMethod = $paymentMethodId === null ? null : $this->resolvePaymentMethod($order, $paymentMethodId);
        $currency = Tenant::findOrFail($order->tenant_id)->currency;

        // PAY-H4-04a — اختيار صريح لطريقة دفع مرتبطة ببوابة (والبوابة المنصّية مفتوحة) يجعل النية إلكترونية `pending`؛ وإلا COD/الاستلام كما كان حرفياً.
        // طريقة مرتبطة ببوابة لكنها غير جاهزة ⇒ رفض (يُلغى الإتمام كله بمعاملته) — لا سقوط صامت إلى COD.
        $status = CommercePaymentIntent::STATUS_AWAITING_COLLECTION;
        // طلبات المتجر الإلكتروني فقط (`storefront_id`)؛ الجوّال/`/commerce/v1` بلا مسار دفع بعد ⇒ سلوكه كما كان.
        if ($paymentMethod !== null && $order->storefront_id !== null && CommerceOnlinePaymentService::enabled() && $this->online->isGatewayLinked($paymentMethod)) {
            $gateway = $this->online->usableGatewayFor($paymentMethod);
            if ($gateway === null) {
                throw new RuntimeException('الدفع الإلكتروني بهذه الطريقة غير متاح حالياً؛ اختر طريقة أخرى.');
            }
            // المزوّد لا يقبل هذا المبلغ/العملة (حدّ أدنى أو عملة غير مدعومة): يُرفض الإتمام قبل الالتزام فيُصحَّح الاختيار بدل طلب لا يُدفع أبداً.
            if (! $this->online->gatewaySupports($gateway, (int) $order->total, (string) $currency)) {
                throw new RuntimeException('الدفع الإلكتروني بهذه الطريقة لا يدعم مبلغ الطلب أو عملته؛ اختر طريقة أخرى.');
            }
            // H4-01 / D-05: الدفع الإلكتروني يُرحَّل بسند قبض يتطلب طرفاً؛ يُحسم الطرف وفق السياسة داخل معاملة الإتمام (COD/الاستلام بلا تغيير).
            $partner = $this->partners->resolveForOrder($order);
            if ($partner !== null && $order->partner_id !== $partner->id) {
                $order->update(['partner_id' => $partner->id]);
            }
            $method = CommercePaymentIntent::METHOD_ONLINE;
            $status = CommercePaymentIntent::STATUS_PENDING;
        }

        return CommercePaymentIntent::create([
            'commerce_order_id' => $order->id,
            'payment_method_id' => $paymentMethod?->id,
            'payment_method_name' => $paymentMethod?->name,
            'method' => $method,
            'status' => $status,
            'amount_minor' => $order->total,
            'currency' => $currency,
        ]);
    }

    /**
     * تحصيلٌ فعلي (نقدي عند التوصيل أو الاستلام) — انتقالٌ صريح واحد، لا
     * قابل للتراجع. لا أثر محاسبي في هذا الإصدار (راجع توثيق رأس الصنف).
     *
     * `lockForUpdate()` + إعادة فحص الحالة داخل المعاملة — `collect`/
     * `cancel` متزامنان على نفس الالتزام كانا سيتسابقان بلا هذا (آخر كاتبٍ
     * يفوز صامتاً، فيترك `cancelled` بـ`collected_at` معبّأ أو يقبل تحصيلاً
     * مزدوجاً)، فحصُ `$intent` المُمرَّر وحده كان يقرأ نسخةً قديمة سابقة للقفل.
     *
     * @throws RuntimeException الحالة الحالية ليست قابلة للتحصيل.
     */
    public function markCollected(CommercePaymentIntent $intent, ?string $note = null): CommercePaymentIntent
    {
        return DB::transaction(function () use ($intent, $note): CommercePaymentIntent {
            $locked = CommercePaymentIntent::query()->whereKey($intent->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== CommercePaymentIntent::STATUS_AWAITING_COLLECTION || $locked->isOnline()) {
                throw new RuntimeException('لا يمكن تحصيل التزام دفع ليس بانتظار التحصيل.');
            }

            $locked->update([
                'status' => CommercePaymentIntent::STATUS_COLLECTED,
                'collected_at' => now(),
                'collection_note' => $note,
            ]);

            return $locked->fresh();
        });
    }

    /**
     * إلغاءٌ صريح — مبلغٌ تحصَّل فعلاً لا يُلغى أبداً (استرجاعٌ منفصل تماماً
     * عن هذا، ADR-04 §14 — Refund != إلغاء التزام دفع لم يُحصَّل).
     *
     * @throws RuntimeException التزام الدفع مُحصَّلٌ بالفعل، أو مُلغىً بالفعل.
     */
    public function cancel(CommercePaymentIntent $intent): CommercePaymentIntent
    {
        // الترتيب (PAY-H4-04a): تُقفَل النية وتُلغى **أولاً** (التزام)، ثم تُغلق محاولاتها الجارية خارج المعاملة. بدء دفع يسابق الإلغاء إما يُرفض عند
        // `assertStillPayable` (نية ملغاة) أو يُتراجع عنه بعد ولادة محاولته (يعيد `start` فحص النية)؛ فلا تبقى صفحة دفع حيّة لنية ملغاة. مبلغ ملتقَط
        // يُرفض إلغاؤه تحت القفل نفسه (يُسترد ولا يُلغى، ADR-04 §14).
        $cancelled = DB::transaction(function () use ($intent): CommercePaymentIntent {
            $locked = CommercePaymentIntent::query()->whereKey($intent->id)->lockForUpdate()->firstOrFail();

            if ($locked->isCollected() || $locked->isPaid()) {
                throw new RuntimeException('لا يمكن إلغاء التزام دفع مُحصَّل بالفعل.');
            }
            if ($locked->isCancelled()) {
                throw new RuntimeException('التزام الدفع مُلغىً بالفعل.');
            }
            if ($locked->isOnline() && $this->online->hasCapture($locked)) {
                throw new RuntimeException('سبق التقاط دفعة لهذا الطلب؛ لا يُلغى التزام الدفع.');
            }

            $locked->update([
                'status' => CommercePaymentIntent::STATUS_CANCELLED,
                'cancelled_at' => now(),
            ]);

            return $locked->fresh();
        });

        if ($cancelled->isOnline()) {
            $this->online->closeActiveAttempts($cancelled); // best-effort؛ التقاط لاحق على صفحة بقيت حيّة يُوسم late_capture للمراجعة
            // H4-02: نية إلكترونية ملغاة (لم يُلتقط شيء — فُحص تحت القفل) ⇒ يُحرَّر حجز مخزون الطلب. فشل التحرير تعالجه المكنسة لاحقاً.
            try {
                app(CommerceOrderReservationService::class)->releaseActive((string) $cancelled->commerce_order_id);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $cancelled;
    }

    /**
     * يُستدعى فقط حين اختار العميل/القناة طريقة دفعٍ صراحةً — راجع توثيق
     * `createForOrder()`. يُعيد التحقّق من إتاحة القناة هنا أيضاً، لا فقط
     * `is_active` — الاختيار قد يسبق الإتمام بوقتٍ كافٍ لتعطيل المؤسسة
     * تلك الطريقة عن القناة تحديداً (`setAvailability()`) في هذه الأثناء؛
     * قبول اختيارٍ لم يعد سارياً كان سيتجاوز السياسة صامتاً.
     */
    private function resolvePaymentMethod(CommerceOrder $order, string $paymentMethodId): PaymentMethod
    {
        $paymentMethod = PaymentMethod::query()
            ->where('tenant_id', $order->tenant_id)
            ->where('is_active', true)
            ->find($paymentMethodId);

        if ($paymentMethod === null) {
            throw new RuntimeException('طريقة الدفع غير موجودة أو معطّلة.');
        }

        $channel = $order->salesChannel;
        if ($channel === null || ! $this->paymentAvailability->isAvailable($paymentMethod, $channel)) {
            throw new RuntimeException('طريقة الدفع لم تعد متاحة لهذه القناة.');
        }

        return $paymentMethod;
    }
}
