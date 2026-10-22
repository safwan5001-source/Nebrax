<?php

namespace App\Contracts;

use App\Models\PaymentGateway;
use App\Support\PaymentAttemptContext;
use App\Support\PaymentGatewayCapabilities;
use App\Support\PaymentHostedCheckout;
use App\Support\PaymentProviderSnapshot;

/**
 * محوّل مزوّد دفع. قواعد العقد: لا شبكة داخل معاملة قاعدة بيانات؛ مفتاح idempotency ثابت لكل استدعاء (= معرّف المحاولة)؛
 * المبالغ هللات صحيحة؛ الأسرار تُقرأ من `PaymentGateway` داخل المحوّل ولا تغادره؛ نطاقات المزوّد ثابتة لكل بيئة.
 *
 * يتسع العقد إضافياً مع الشرائح (التحقق من الاعتماد وWebhook في H1-04/H2-01، الالتقاط/الإلغاء/الاسترداد/التسويات في H2–H3)
 * ولا يُوسَّع هنا بما لا يستهلكه المنسّق اليوم.
 */
interface GatewayAdapter
{
    public function provider(): string;

    public function capabilities(): PaymentGatewayCapabilities;

    /** صفحة دفع مستضافة (Hosted/redirect فقط). نفس `attemptId` ⇒ نفس النتيجة (idempotent عند المزوّد). */
    public function createCheckout(PaymentAttemptContext $context): PaymentHostedCheckout;

    /** حقيقة المزوّد الآن — الأحداث الواردة لا تُصدَّق من جسمها بل تطلق هذا الاستعلام. */
    public function fetchPayment(PaymentGateway $gateway, string $providerPaymentId): PaymentProviderSnapshot;
}
