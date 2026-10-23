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
    ) {}

    public function supportsAmount(int $amountMinor): bool
    {
        return $amountMinor >= max(1, $this->minAmountMinor);
    }

    public function supportsCurrency(string $currency): bool
    {
        return in_array(strtoupper($currency), $this->currencies, true);
    }
}
