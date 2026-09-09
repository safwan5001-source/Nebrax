<?php

namespace App\Support;

/**
 * نطاق الفرع الفعّال (Effective Branch Scope) للتقارير التحليلية المجمّعة.
 *
 * مرآة حرفية لمنطق `ReportService::branchIds()` — نفس القاعدة والسلوك،
 * بلا إعادة تعريف. مرجع القرار الوحيد يبقى هناك؛ هذا الملف يعيد استخدام نفس
 * المعادلة لخدمات `App\Services\Reporting\*ReportService` التي لا ترث
 * `ReportService` (Sales/Purchase/Inventory/Customer/Classification Analytics).
 *
 * @see \App\Services\Reporting\ReportService::branchIds()
 */
class ReportBranchScope
{
    /**
     * requested branch scope ∩ user's allowed branches ∩ tenant.
     *
     * القاعدة: نطاق المستخدم يحدّ المطلوب لا العكس. مستخدمٌ مقيَّد بفروع لا
     * يرى غيرها بمجرّد إغفال المرشّح (تُفرض فروعه كلها)، ولا بطلب فرعٍ ليس
     * له (تُعاد فروعه هو، لا نتيجة فارغة توهم بغياب البيانات ولا الفرع الممنوع).
     * غير المقيَّد (`allowedBranchIds() === null`) يبقى بلا قيد — توافق رجعي كامل.
     *
     * @param  array<string,mixed>  $filters  يقرأ `branch_id` فقط (مصفوفة UUID أو فارغة/غائبة).
     * @return array<int,string>|null  null = بلا تصفية (مستخدم غير مقيَّد ولم يطلب شيئاً).
     */
    public static function resolve(array $filters): ?array
    {
        $raw = $filters['branch_id'] ?? null;
        $ids = $raw === null || $raw === '' || $raw === []
            ? []
            : array_values(array_filter(is_array($raw) ? $raw : [$raw]));

        $allowed = auth()->user()?->allowedBranchIds();

        if ($allowed !== null) {
            $ids = $ids === [] ? $allowed : array_values(array_intersect($ids, $allowed));

            return $ids === [] ? $allowed : $ids;
        }

        return $ids === [] ? null : $ids;
    }
}
