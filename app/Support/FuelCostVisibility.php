<?php

namespace App\Support;

use App\Models\User;

/**
 * FS-23: حقول التكلفة والهامش وسقف الائتمان في وحدة الوقود تتبع الصلاحيات الحسّاسة القائمة
 * (لا صلاحية جديدة): التكلفة/الهامش = `products.view_cost` عبر `SensitiveCostPolicy`،
 * وسقف الائتمان = `fuel.credit.view`. صلاحيات العرض التشغيلية (`fuel.sale.view`،
 * `fuel.reports.view`، `fuel.contract.view`) وحدها لا تكشفها.
 */
final class FuelCostVisibility
{
    /** مفاتيح التكلفة/الهامش في استجابات تقارير الوقود ولوحته. */
    public const REPORT_COST_KEYS = ['cogs_minor', 'margin_minor', 'gross_margin_minor', 'value_minor'];

    public static function canSeeCost(?User $user): bool
    {
        return SensitiveCostPolicy::authorized($user);
    }

    public static function canSeeCredit(?User $user): bool
    {
        return $user !== null && Rbac::allows((string) $user->role, 'fuel.credit.view');
    }

    /**
     * يحذف مفاتيح التكلفة (المفتاح كاملاً لا قيمته فقط) من أي عمق.
     *
     * @param  array<mixed>  $data
     * @return array<mixed>
     */
    public static function redactReport(array $data, bool $authorized): array
    {
        if ($authorized) {
            return $data;
        }
        foreach ($data as $key => $value) {
            if (is_string($key) && in_array($key, self::REPORT_COST_KEYS, true)) {
                unset($data[$key]);
            } elseif (is_array($value)) {
                $data[$key] = self::redactReport($value, false);
            }
        }

        return $data;
    }
}
