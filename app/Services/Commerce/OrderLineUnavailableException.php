<?php

namespace App\Services\Commerce;

use Throwable;

/** نقص مخزون سطر طلب بعينه عند الحجز (H4-02)؛ يرث الاستثناء العام فلا ينكسر أي مستدعٍ قائم. */
final class OrderLineUnavailableException extends InsufficientAvailabilityException
{
    public function __construct(
        public readonly string $productId,
        public readonly ?string $variantId,
        string $message,
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }
}
