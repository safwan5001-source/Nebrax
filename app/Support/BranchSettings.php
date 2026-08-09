<?php

namespace App\Support;

use App\Models\Branch;
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
        'share_customers'        => true,  // مشاركة العملاء بين الفروع
        'share_products'         => true,  // مشاركة المنتجات والخدمات
        'share_suppliers'        => true,  // مشاركة الموردين
        'share_cost_centers'     => true,  // ربط مراكز التكلفة بين الفروع
        'account_branch_scoping' => false, // تخصيص الحسابات على مستوى الفروع
    ];

    /**
     * الإعدادات الحالية. **`main_branch_id` مشتقّ من العمود `branches.is_main`**
     * (مصدر الحقيقة الوحيد) لا من الـ JSON — فلا يضيع صامتاً ولا يتصادم.
     */
    public static function current(): array
    {
        $stored = self::tenant()->settings['branches'] ?? [];
        unset($stored['main_branch_id']); // أثر قديم يُتجاهَل

        return array_merge(self::DEFAULTS, $stored, [
            'main_branch_id' => Branch::main()?->id,
        ]);
    }

    /**
     * يضبط الفرع الرئيسي — الإجراء الصريح الوحيد (من «إعدادات الفروع» حصراً).
     * `null` يُهمَل: المؤسسة لا تُترك بلا فرع رئيسي.
     */
    public static function setMainBranch(?string $branchId): void
    {
        if ($branchId === null) {
            return;
        }
        Branch::findOrFail($branchId)->makeMain();
    }

    /**
     * يدمج مفاتيح المشاركة ويحفظها. `main_branch_id` **لا يُحفظ في الـ JSON** —
     * يُوجَّه إلى العمود عبر setMainBranch (مصدر حقيقة واحد).
     */
    public static function merge(array $patch): array
    {
        if (array_key_exists('main_branch_id', $patch)) {
            self::setMainBranch($patch['main_branch_id']);
            unset($patch['main_branch_id']);
        }

        $tenant   = self::tenant();
        $current  = self::current();
        unset($current['main_branch_id']);
        $branches = array_merge($current, array_filter($patch, fn ($v) => $v !== null));

        $settings = $tenant->settings ?? [];
        $settings['branches'] = $branches;
        $tenant->update(['settings' => $settings]);

        return self::current();
    }

    private static function tenant(): Tenant
    {
        return Tenant::findOrFail(app(TenantContext::class)->id());
    }
}
