<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * COM-CHECKOUT-1B — إعادة تحقّق نهائية فشلت: سطرٌ أصبح غير متاح/سعرٌ غير
 * قابل للحسم/وحدة غير صالحة/مخزونٌ غير كافٍ (AWJ_CHECKOUT_V1_ARCHITECTURE.md
 * §9 — "MUST NOT silently create an order"). لا Order يُنشأ؛ `$details`
 * تحمل السبب لكل سطرٍ متأثّر ليعرضها المتحكّم مع حالة Checkout/Cart الحالية
 * الموثوقة.
 */
class CheckoutReviewRequiredException extends RuntimeException
{
    /** @param array<int, array{item_id: string, reason: string}> $details */
    public function __construct(string $message, private readonly array $details)
    {
        parent::__construct($message);
    }

    /** @return array<int, array{item_id: string, reason: string}> */
    public function details(): array
    {
        return $this->details;
    }
}
