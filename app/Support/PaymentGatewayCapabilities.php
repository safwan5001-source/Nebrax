<?php

namespace App\Support;

/** قدرات محوّل مزوّد (ما يدعمه فعلياً، لا ما يُعلنه التاجر). */
final class PaymentGatewayCapabilities
{
    /**
     * @param  list<string>  $currencies  رموز ISO 4217
     * @param  int  $minAmountMinor  أقل مبلغ (هللات) يقبله المزوّد؛ يفحصه المنسّق **قبل** حفظ المحاولة فلا تبقى محاولة نشطة عالقة لمبلغ لا يُقبل أبداً.
     */
    public function __construct(
        public readonly bool $hostedCheckout,
        public readonly array $currencies,
        public readonly int $minAmountMinor = 1,
        /** يدعم المحوّل استرداد دفعة ملتقَطة (`RefundsPayments`). الافتراضي لا: لا قدرة تُعلَن بلا تنفيذ (PAY-H3-01a). */
        public readonly bool $refunds = false,
        /**
         * وسائل الدفع الإلكتروني (`OnlinePaymentMethodCatalog`) التي **توثّق** وثائق المزوّد دعمها لحسابه. لا يعني أن صفحة الدفع المستضافة تقبلها: ذلك يُضبط في لوحة المزوّد
         * (واجهة الفواتير لدى Moyasar بلا معامل لتقييد الوسائل) ويُتحقق منه في Sandbox. الافتراضي لا شيء: لا قدرة تُعلَن بلا توثيق.
         *
         * @var list<string>
         */
        public readonly array $methods = [],
        /**
         * جزء من `methods` يحتاج إعداداً لدى المزوّد لا يستطيع أَوْج التحقق منه (مثل تسجيل نطاق Apple Pay، EXT-10) فلا يُعدّ جاهزاً تلقائياً.
         *
         * @var list<string>
         */
        public readonly array $methodsRequiringProviderSetup = [],
    ) {}

    public function supportsMethod(string $method): bool
    {
        return in_array($method, $this->methods, true);
    }

    public function supportsAmount(int $amountMinor): bool
    {
        return $amountMinor >= max(1, $this->minAmountMinor);
    }

    public function supportsCurrency(string $currency): bool
    {
        return in_array(strtoupper($currency), $this->currencies, true);
    }
}
