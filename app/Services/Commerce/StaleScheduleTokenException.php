<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * CUST-H1-4 — `expected_schedule_token` لا يطابق `schedule_epoch` الحالي
 * المقفول على رأس المتجر. يُرفض قبل أي تحوّر في حالة الجدولة — لا فرق بين
 * "لا جدولة قائمة" و"جدولة قائمة": كلتاهما حالة `schedule_epoch` صالحة يجب
 * التحقّق منها (docs/plans/store/CUST-H1-ARCH-1-...md §10).
 */
final class StaleScheduleTokenException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('حالة الجدولة تغيّرت منذ آخر مراجعة. أعد تحميل حالة المتجر الحالية ثم أعد المحاولة.');
    }
}
