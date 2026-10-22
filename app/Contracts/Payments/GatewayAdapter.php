<?php

namespace App\Contracts\Payments;

use App\Models\PaymentGateway;
use App\Support\Payments\AttemptContext;
use App\Support\Payments\GatewayCapabilities;
use App\Support\Payments\HostedCheckout;
use App\Support\Payments\ProviderPaymentSnapshot;

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

    public function capabilities(): GatewayCapabilities;

    /** صفحة دفع مستضافة (Hosted/redirect فقط). نفس `attemptId` ⇒ نفس النتيجة (idempotent عند المزوّد). */
    public function createCheckout(AttemptContext $context): HostedCheckout;

    /** حقيقة المزوّد الآن — الأحداث الواردة لا تُصدَّق من جسمها بل تطلق هذا الاستعلام. */
    public function fetchPayment(PaymentGateway $gateway, string $providerPaymentId): ProviderPaymentSnapshot;
}
