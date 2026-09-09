<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * تعارض idempotency متوقّع: مفتاح الحجز أُعيد استخدامه بحمولة مادية مختلفة
 * (منتج/مخزن/كمية/مصدر) عن أول استخدام له. نظير
 * `App\Services\Pos\PosIdempotencyConflictException` لنفس المبدأ في مسار
 * Commerce — تعارضٌ صريح لا استبدالٌ صامت للحجز الأول.
 */
class InventoryReservationIdempotencyConflictException extends RuntimeException
{
}
