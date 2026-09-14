<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * COM-CHECKOUT-1B — نفس Idempotency-Key بحمولة طلبٍ مختلفة عن أول استخدامه
 * لهذا الـ Checkout، أو مفتاحٌ مختلف على Checkout مكتمل بالفعل (لا يجوز أن
 * ينشئ طلباً ثانياً — AWJ_CHECKOUT_V1_ARCHITECTURE.md §9). نظير
 * `InventoryReservationIdempotencyConflictException` لنفس المبدأ.
 */
class CheckoutIdempotencyConflictException extends RuntimeException {}
