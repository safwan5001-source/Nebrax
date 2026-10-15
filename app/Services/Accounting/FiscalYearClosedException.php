<?php

namespace App\Services\Accounting;

/**
 * FC-3 — رُفض أثرٌ محاسبي تاريخه داخل سنة مالية **مقفلة** (`fiscal_years.status = closed`).
 *
 * يرث `AccountingPeriodLockedException` عمداً: كل من يعالج «التاريخ مقفل» اليوم — `ApiController::domain()`
 * (422 بالنص العربي) وكل اختبار أو مستهلك يلتقط نوع ACC-6 — يعالج هذا بلا تغيير. والنوع المستقلّ يميّز
 * سبب الرفض (سنة مقفلة لا قفل فترة) بلا مطابقة نصوص. التصحيح: فتح السنة رسمياً (`fiscal_years.reopen` بسبب
 * مسجَّل) أو تأريخ العملية في فترة مفتوحة — لا مفتاح تجاوز.
 */
class FiscalYearClosedException extends AccountingPeriodLockedException
{
}
