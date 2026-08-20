<?php

namespace App\Support;

use App\Models\Role;
use App\Tenancy\TenantContext;

/**
 * مصفوفة صلاحيات الأدوار (RBAC).
 *
 * **المصدر يتحوّل من ثابتٍ إلى قابل للضبط:** ما دام للمستأجر صفُّ دورٍ في جدول
 * `roles` فهو الحقيقة؛ وإلّا نسقط على `MATRIX` الثابتة أدناه (تركيبات جديدة قبل
 * الزرع، اختبارات، وسلامة). فالمستأجرون القائمون لا يتغيّر سلوكهم قبل أي تعديل.
 *
 * owner/admin: كل الصلاحيات. accountant: العمليات المالية. staff: قراءة فقط.
 */
class Rbac
{
    public const MATRIX = [
        'owner' => ['*'],
        'admin' => ['*'],
        'accountant' => [
            'partners.view', 'partners.manage',
            'products.view', 'products.manage',
            'invoices.view', 'invoices.manage',
            'payments.view', 'payments.manage',
            'purchases.view', 'purchases.manage',
            'returns.view', 'returns.manage',
            'hr.view', 'hr.manage',
            'expenses.view', 'expenses.manage',
            'assets.view', 'assets.manage',
            'cost_centers.view', 'cost_centers.manage',
            // الفروع بنية تنظيمية: العرض متاح للعمل اليومي، والإدارة للمالك/المدير فقط.
            'branches.view',
            'accounts.view', 'reports.view', 'zatca.view',
        ],
        'staff' => [
            'partners.view', 'products.view', 'invoices.view',
            'payments.view', 'purchases.view', 'returns.view',
            'hr.view', 'expenses.view', 'assets.view', 'cost_centers.view',
            'branches.view',
            'accounts.view', 'reports.view', 'zatca.view',
        ],
    ];

    /**
     * كل الصلاحيات القابلة للإسناد لدورٍ مخصَّص (مصدر الحقيقة للواجهة والتحقّق).
     * مشتقّة من مسارات `routes/api.php` مضافاً إليها إدارة الأدوار نفسها.
     */
    public const PERMISSIONS = [
        'partners.view', 'partners.manage',
        'products.view', 'products.manage',
        'invoices.view', 'invoices.manage',
        'payments.view', 'payments.manage',
        'purchases.view', 'purchases.manage',
        'returns.view', 'returns.manage',
        'hr.view', 'hr.manage',
        'expenses.view', 'expenses.manage',
        'assets.view', 'assets.manage',
        'cost_centers.view', 'cost_centers.manage',
        'accounts.view', 'accounts.manage',
        'branches.view', 'branches.manage',
        'company.manage',
        'users.view', 'users.manage',
        'roles.view', 'roles.manage',
        'reports.view', 'zatca.view',
        'apps.view', 'apps.manage',
    ];

    /**
     * تعريف الأدوار النظامية الأربعة (اسم + صلاحيات) — يُزرع لكل مؤسسة نسخةً طبق
     * الأصل من `MATRIX`، فيبقى السلوك متطابقاً قبل أي تعديل.
     *
     * @return array<string, array{name: string, permissions: array<int, string>}>
     */
    public static function systemRoles(): array
    {
        return [
            'owner'      => ['name' => 'المالك', 'permissions' => self::MATRIX['owner']],
            'admin'      => ['name' => 'مدير',   'permissions' => self::MATRIX['admin']],
            'accountant' => ['name' => 'محاسب',  'permissions' => self::MATRIX['accountant']],
            'staff'      => ['name' => 'موظف',   'permissions' => self::MATRIX['staff']],
        ];
    }

    /** هل يمنح الدور الصلاحية؟ يقرأ صفّ الدور للمستأجر النشط، وإلّا `MATRIX`. */
    public static function allows(string $role, string $permission): bool
    {
        $perms = self::resolve($role);

        return in_array('*', $perms, true) || in_array($permission, $perms, true);
    }

    /** هل الدور موجود (في جدول المستأجر أو في المصفوفة الثابتة)؟ */
    public static function roleExists(string $slug): bool
    {
        if (array_key_exists($slug, self::MATRIX)) {
            return true;
        }

        try {
            return Role::where('slug', $slug)->exists();
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * صلاحيات الدور: من جدول `roles` للمستأجر النشط إن وُجد صفُّه، وإلّا من
     * `MATRIX` الثابتة. لا تخزين مؤقّت — القراءة على مسارٍ أمنيٍّ تبقى طازجة
     * دائماً، و`EnsurePermission` يستدعيها مرّة لكل طلب.
     *
     * @return array<int, string>
     */
    private static function resolve(string $role): array
    {
        if (app(TenantContext::class)->has()) {
            try {
                $found = Role::where('slug', $role)->first();
                if ($found !== null) {
                    return $found->permissions ?? [];
                }
            } catch (\Throwable) {
                // جدول `roles` غير موجود بعد (قبل الهجرة) → المصفوفة الثابتة.
            }
        }

        return self::MATRIX[$role] ?? [];
    }
}
