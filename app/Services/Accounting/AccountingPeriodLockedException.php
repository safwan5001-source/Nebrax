<?php

namespace App\Services\Accounting;

use RuntimeException;

/**
 * ACC-6 — رُفض إنشاء أثر محاسبي داخل نطاق تاريخ مقفل.
 *
 * يرث `RuntimeException` عمداً: `ApiController::domain()` يحوّله إلى 422 بالنص
 * العربي نفسه الذي يراه المستخدم، فلا يحتاج كل متحكّم ترحيل معالجةً خاصة.
 * والنوع المستقلّ يتيح للاختبارات (وللمستهلكين مستقبلاً) تمييز «الفترة مقفلة»
 * عن أي خطأ عملٍ آخر بلا مطابقة نصوص.
 */
class AccountingPeriodLockedException extends RuntimeException
{
}
