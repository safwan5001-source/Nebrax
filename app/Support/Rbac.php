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
            'delivery_notes.view', 'delivery_notes.manage', 'delivery_notes.confirm', 'delivery_notes.cancel', 'delivery_notes.invoice',
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
            'partners.view', 'products.view', 'invoices.view', 'delivery_notes.view',
            'payments.view', 'purchases.view', 'returns.view',
            'hr.view', 'expenses.view', 'assets.view', 'cost_centers.view',
            'branches.view',
            'accounts.view', 'reports.view', 'zatca.view',
        ],
        // بوابة الخدمة الذاتية للموظف: دورٌ مقيَّد بصلاحية واحدة فقط، لا تُسند
        // إليه صلاحيات hr.* الواسعة (غير معزولة بالسجل). مسارات `/me/*` وحدها
        // تمنح الوصول، ومقيَّدة بنيوياً لبيانات صاحب الحساب (`employee_id`)
        // دون سواه — انظر design-system/foundations/hr-users-architecture.md.
        'self_service' => ['self_service.access'],
    ];

    /**
     * كل الصلاحيات القابلة للإسناد لدورٍ مخصَّص (مصدر الحقيقة للواجهة والتحقّق).
     * مشتقّة من مسارات `routes/api.php` مضافاً إليها إدارة الأدوار نفسها.
     */
    public const PERMISSIONS = [
        'partners.view', 'partners.manage',
        'products.view', 'products.manage',
        'invoices.view', 'invoices.manage',
        'delivery_notes.view', 'delivery_notes.manage', 'delivery_notes.confirm', 'delivery_notes.cancel', 'delivery_notes.invoice',
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
            // استثناء سعري محروس: owner/admin يملكانه عبر `*`، ويُسند صراحةً
            // فقط إلى دور مخصص وافق المستأجر على منحه سلطة البيع تحت الحد.
            'sales.minimum_price_override',
            // اعتماد فرق درج POS سلطة إدارية مستقلة عن تنفيذ البيع اليومي.
            'pos.variance.approve',
            // استلام عهدة إغلاق جلسة POS يحتاج مستخدماً ثانياً مخولاً.
            'pos.session.handover.confirm',
            // فتح الدرج لا يورّث من صلاحية البيع؛ يضاف فقط لدور مخصص أو عبر *.
            'pos.cash_drawer.open',
            // الرقابة والتدقيق مساحة واحدة مستقلة عن مسمى الدور. يفصل العرض عن
            // المراجعة والتصدير والاعتماد وإدارة سياسات الأدلة.
            'pos.audit.view', 'pos.audit.review', 'pos.audit.export',
            'pos.override.approve', 'pos.audit.settings.manage',
            // Phase 2: إعادة حساب الذكاء الرقابي سلطة مستقلة عن العرض/المراجعة؛
            // owner/admin يملكانها عبر `*`، وتُسند صراحةً لدور مخصص عند الحاجة.
            'pos.audit.recalculate',
            // Phase 3: إدارة قضايا التحقيق مساحة مستقلة عن مراجعة الاستثناءات الخفيفة —
            // العرض والإنشاء والإدارة والتعيين والحسم والتصدير سلطات منفصلة، ومرجع
            // الكاميرا صلاحية مستقلة بذاتها لا يرثها من `manage` العامة. لا تُضاف لمصفوفتَي
            // accountant/staff تلقائياً (نفس نمط pos.audit.*)؛ owner/admin عبر `*`.
            'pos.investigations.view', 'pos.investigations.create', 'pos.investigations.manage',
            'pos.investigations.assign', 'pos.investigations.resolve', 'pos.investigations.export',
            'pos.cctv.bookmark.manage',
            'apps.view', 'apps.manage',
            // إدارة المطوّرين (PR-7.5): عرض/إدارة عملاء الـ API ومفاتيحها واشتراكات
            // الـ Webhooks وسجلّ التسليم — سطح إدارة داخليّ للمستأجر. المالك/المدير
            // يملكانها عبر `*`؛ ولا تُضاف لأدوار accountant/staff تلقائياً.
            'developer.view', 'developer.manage',
            // Fuel Stations: يمنحها المالك/المدير عبر `*`، ولا تُضاف للأدوار
            // المقيدة تلقائياً؛ تُسند فقط عبر دور مخصص أو قرار مستأجر صريح.
            'fuel_stations.view', 'fuel_stations.manage',
            'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.close', 'fuel.shift.approve',
            'fuel.shift.correct', 'fuel.shift.cash_count', 'fuel.shift.cash_variance_review',
            'fuel.sale.view', 'fuel.sale.create', 'fuel.sale.finalize', 'fuel.sale.collect', 'fuel.sale.price.manage',
            // Cycle 6: سلطات العقد والائتمان والبطاقة مستقلة، ولا ترثها
            // أدوار المحطة من fuel_stations.manage.
            'fuel.contract.view', 'fuel.contract.manage', 'fuel.contract.activate', 'fuel.contract.suspend',
            'fuel.fleet.view', 'fuel.fleet.manage',
            'fuel.card.view', 'fuel.card.manage', 'fuel.card.suspend',
            // Cycle 7: العرض والإدارة وإصدار القرار منفصلة؛ لا يرثها مسؤول
            // المحطة من fuel_stations.manage ولا بطاقة الوقود منطقياً.
            'fuel.avi.view', 'fuel.avi.manage', 'fuel.avi.authorize',
            // Cycle 8: سجل الأجهزة وإدخال الأدلة وإعادة المعالجة صلاحيات منفصلة؛
            // لا تمنح تشغيل محول أو أمراً خارجياً ولا ترث من إدارة المحطة العامة.
            'fuel.device.view', 'fuel.device.manage',
            'fuel.integration.view', 'fuel.integration.ingest', 'fuel.integration.retry',
            // مركز المستندات: العرض والإدارة والمراجعة والإعداد سلطات مستقلة.
            // لا ترثها الأدوار المقيدة من صلاحيات المستندات المحاسبية العامة.
            'documents.center.view', 'documents.center.manage',
            'documents.center.review', 'documents.center.settings', 'documents.center.build_draft',
            'documents.center.operations', 'documents.center.retry',
            'documents.center.usage', 'documents.center.audit_export',
            // Cycle 9: الصيانة والسلامة والتقارير والتنبيهات سلطات تشغيلية
            // مستقلة؛ لا تمنحها إدارة المحطة أو التصفح العام ضمنياً.
            'fuel.maintenance.view', 'fuel.maintenance.manage', 'fuel.maintenance.transition',
            'fuel.safety.view', 'fuel.safety.manage', 'fuel.safety.inspect', 'fuel.safety.verify',
            'fuel.alerts.view', 'fuel.alerts.manage', 'fuel.reports.view',
            'fuel.credit.view', 'fuel.credit.manage',
            // بوابة الخدمة الذاتية — انظر تعليق دور `self_service` أعلاه.
            'self_service.access',
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
            'self_service' => ['name' => 'الخدمة الذاتية', 'permissions' => self::MATRIX['self_service']],
        ];
    }

    /** هل يمنح الدور الصلاحية؟ يقرأ صفّ الدور للمستأجر النشط، وإلّا `MATRIX`. */
    public static function allows(string $role, string $permission): bool
    {
        $perms = self::resolve($role);

        return in_array('*', $perms, true) || in_array($permission, $perms, true);
    }

    /** @return array<int,string> قائمة الصلاحيات الفعلية للعميل المصادق، للعرض فقط. */
    public static function permissionsForRole(string $role): array
    {
        return self::resolve($role);
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
