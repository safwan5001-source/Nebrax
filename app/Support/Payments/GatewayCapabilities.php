<?php

namespace App\Support\Payments;

/** قدرات محوّل مزوّد (ما يدعمه فعلياً، لا ما يُعلنه التاجر). */
final class GatewayCapabilities
{
    /** @param list<string> $currencies رموز ISO 4217 */
    public function __construct(
        public readonly bool $hostedCheckout,
        public readonly array $currencies,
    ) {}

    public function supportsCurrency(string $currency): bool
    {
        return in_array(strtoupper($currency), $this->currencies, true);
    }
}
