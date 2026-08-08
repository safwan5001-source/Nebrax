<?php

namespace App\Support;

use App\Models\Tenant;
use App\Tenancy\TenantContext;

/**
 * إعدادات الفروع — تفضيلات غير محاسبية تُخزَّن في `tenants.settings['branches']`:
 * الفرع الرئيسي + مفاتيح مشاركة البيانات بين الفروع.
 *
 * **الافتراضات تحافظ على السلوك الحالي حرفياً**: المشاركة مفعّلة (لا تصفية بالفرع
 * = مؤسسة أحادية الفرع كما اليوم)، وتخصيص الحسابات معطّل (الحسابات عامّة).
 */
class BranchSettings
{
    public const DEFAULTS = [
        'main_branch_id'         => null,  // الفرع الرئيسي
        'share_customers'        => true,  // مشاركة العملاء بين الفروع
        'share_products'         => true,  // مشاركة المنتجات والخدمات
        'share_suppliers'        => true,  // مشاركة الموردين
        'share_cost_centers'     => true,  // ربط مراكز التكلفة بين الفروع
        'account_branch_scoping' => false, // تخصيص الحسابات على مستوى الفروع
    ];

    /** الإعدادات الحالية للمستأجر مدموجةً بالافتراضات. */
    public static function current(): array
    {
        return array_merge(self::DEFAULTS, self::tenant()->settings['branches'] ?? []);
    }

    /** يدمج تعديلاً جزئياً ويحفظه، ويعيد الإعدادات بعد الدمج. */
    public static function merge(array $patch): array
    {
        $tenant   = self::tenant();
        $branches = array_merge(self::current(), array_filter($patch, fn ($v) => $v !== null));

        $settings = $tenant->settings ?? [];
        $settings['branches'] = $branches;
        $tenant->update(['settings' => $settings]);

        return $branches;
    }

    private static function tenant(): Tenant
    {
        return Tenant::findOrFail(app(TenantContext::class)->id());
    }
}
