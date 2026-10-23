<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * نتيجة استدعاء استرداد لدى المزوّد، مطبَّعة إلى هللات. `refundedMinor` هو **المبلغ المسترد التراكمي** لهذه الدفعة بعد الاستدعاء (حقيقة المزوّد)،
 * وهو الأساس الوحيد لإثبات التأكيد ومنع الازدواج: يُقارَن بالتراكمي قبل الاستدعاء. لا يحمل أسراراً ولا جسم الاستجابة.
 */
final class PaymentProviderRefund
{
    public function __construct(
        public readonly string $providerPaymentId,
        public readonly int $refundedMinor,
        public readonly string $currency,
        public readonly ?CarbonImmutable $refundedAt = null,
    ) {
        if ($providerPaymentId === '' || $refundedMinor < 0 || strlen($currency) !== 3) {
            throw new InvalidArgumentException('Invalid provider refund result.');
        }
    }
}
