<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * انتقال حالة غير مسموح على حجزٍ ليس في الحالة المطلوبة له (مثل استهلاك حجزٍ
 * مُفرَج عنه، أو إفراج عن حجزٍ منتهٍ). العقد: `ACTIVE` وحدها تقبل الانتقال؛
 * إعادة نفس الانتقال على نتيجته هو عملية آمنة لإعادة المحاولة لا خطأ (انظر
 * `InventoryReservationService::release()`/`consume()`/`expire()`).
 */
class InvalidReservationStateTransitionException extends RuntimeException
{
}
