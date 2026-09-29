<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * CUST-H1-3 — حالة رأس النشر (`published_revision`/`active_version_id`)
 * التي راجعها التاجر لم تعد الحالة الحالية المقفولة. ينشر جلسة أخرى بينما
 * هذا الطلب قيد الإرسال، فيُرفض قبل أي تغيير في الحالة الحيّة — لا إعادة
 * محاولة تلقائية، ولا دمج ضمني لحالة الرأس.
 */
final class StalePublicationHeadException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('حالة النشر تغيّرت منذ آخر مراجعة. أعد تحميل حالة المتجر الحالية قبل النشر من جديد.');
    }
}
