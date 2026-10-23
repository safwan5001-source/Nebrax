<?php

namespace App\Contracts;

use App\Models\PaymentGateway;
use App\Support\PaymentAttemptContext;
use App\Support\PaymentGatewayCapabilities;
use App\Support\PaymentHostedCheckout;
use App\Support\PaymentProviderSnapshot;
use App\Support\PaymentRawWebhook;
use App\Support\PaymentVerifiedWebhook;

/**
 * محوّل مزوّد دفع. قواعد العقد: لا شبكة داخل معاملة قاعدة بيانات؛ مفتاح idempotency ثابت لكل استدعاء (= معرّف المحاولة)؛
 * المبالغ هللات صحيحة؛ الأسرار تُقرأ من `PaymentGateway` داخل المحوّل ولا تغادره؛ نطاقات المزوّد ثابتة لكل بيئة.
 *
 * يتسع العقد إضافياً مع الشرائح (التحقق من الاعتماد وWebhook في H1-04/H2-01، الالتقاط/الإلغاء/الاسترداد/التسويات في H2–H3)
 * ولا يُوسَّع هنا بما لا يستهلكه المنسّق/صندوق الأحداث اليوم.
 */
interface GatewayAdapter
{
    public function provider(): string;

    public function capabilities(): PaymentGatewayCapabilities;

    /** صفحة دفع مستضافة (Hosted/redirect فقط). نفس `attemptId` ⇒ نفس النتيجة (idempotent عند المزوّد). */
    public function createCheckout(PaymentAttemptContext $context): PaymentHostedCheckout;

    /**
     * يتحقق من توقيع webhook وارد بأسرار الاتصال (`webhookSecretsForVerification()`: الحالي ثم السابق في نافذة السماح) ويستخرج معرّف الحدث ونوعه ومرجع
     * الدفعة. يرمي `InvalidPaymentWebhookException` (`signature` أو `malformed`). لا يطبّق حالة: الحدث يطلق `fetchPayment` فقط.
     */
    public function verifyWebhook(PaymentGateway $gateway, PaymentRawWebhook $webhook): PaymentVerifiedWebhook;

    /** حقيقة المزوّد الآن — الأحداث الواردة لا تُصدَّق من جسمها بل تطلق هذا الاستعلام. */
    public function fetchPayment(PaymentGateway $gateway, string $providerPaymentId): PaymentProviderSnapshot;
}
