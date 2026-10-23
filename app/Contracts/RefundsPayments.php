<?php

namespace App\Contracts;

use App\Models\PaymentGateway;
use App\Support\PaymentProviderRefund;

/**
 * قدرة اختيارية لمحوّل المزوّد: استرداد (كلي أو جزئي) دفعة ملتقَطة (PAY-H3-01a، ADR-0007). **لا يحرّك محاسبة**: يستدعي المزوّد فقط؛ القيد يُرحَّل بعد
 * التأكيد من خدمة الاسترداد (شريحة لاحقة) عبر `LedgerService`.
 *
 * قواعد العقد (تُفرض على كل محوّل):
 *  • **لا إعادة محاولة تلقائية داخل المحوّل أبداً.** لا مفتاح idempotency موثّق للاسترداد لدى المزوّد الأول؛ التكرار يمنعه المستدعي بمطابقة `refundedMinor`
 *    التراكمي من `fetchPayment` قبل أي إعادة إرسال.
 *  • النتيجة: يُرجع `PaymentProviderRefund` عند ردّ مفهوم من المزوّد؛ أو يرمي **`PaymentRefundRejectedException`** (لم يُنفَّذ شيء قطعاً: رفض/اعتماد/
 *    سقف/غموض قبل الإرسال) أو **`PaymentRefundUnknownException`** (قد يكون نُفِّذ: انقطاع/مهلة/5xx/استجابة غير مفهومة بعد الإرسال). لا نتيجة ثالثة.
 *  • المبالغ هللات صحيحة؛ لا شبكة داخل معاملة قاعدة بيانات؛ الأسرار لا تغادر المحوّل ولا تظهر في الرسائل.
 */
interface RefundsPayments
{
    /**
     * @param  string  $providerPaymentId  مرجع الدفعة كما تحمله `payment_attempts.provider_payment_id` (مرجع المحاولة لدى المزوّد، قد يكون فاتورة لا دفعة)
     * @param  int  $amountMinor  مبلغ الاسترداد (> 0) بهللات؛ التراكمي بعده يظهر في `PaymentProviderRefund::$refundedMinor`
     */
    public function refundPayment(PaymentGateway $gateway, string $providerPaymentId, int $amountMinor): PaymentProviderRefund;
}
