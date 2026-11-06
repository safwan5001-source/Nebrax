<?php

namespace App\Support;

/**
 * FUEL-B3: قوالب صلاحيات موظفي المحطات — قوائم مفاتيح من `Rbac::PERMISSIONS` القائمة، لا نظام صلاحيات موازٍ.
 *
 * القالب **وصفة** تُنسخ إلى دور شخصي لكل موظف (`FuelStaffAccessService`)، فتعديل صلاحيات موظف لا يمسّ غيره، وتعديل القالب هنا لا يغيّر موظفاً قائماً.
 *
 * قواعد ثابتة (يحرسها `FuelStaffTemplatesTest`):
 *  - مفاتيح الوقود (`fuel.*` و`fuel_stations.*`) فقط — لا محاسبة ولا إدارة عامة ولا `products.view_cost` ولا `roles.*`/`users.*`.
 *  - لا `fuel.governance.manage` ولا `fuel.staff.manage` ولا `fuel_stations.manage` الواسع في أي قالب (مفاتيح دقيقة بدلها).
 *  - المشرف ⊇ البائع، ومدير المحطة ⊇ المشرف.
 */
final class FuelStaffTemplates
{
    public const SELLER = 'seller';
    public const SUPERVISOR = 'supervisor';
    public const STATION_MANAGER = 'station_manager';

    /**
     * مفاتيح لا تدخل قالباً ولا «كل صلاحيات الوقود» أبداً، ولا تُمنح بإسناد فردي إلا من حامل `*` (owner/admin):
     * بها يُفوَّض التفويض نفسه أو يُعطَّل ضابط فصل المعتمِد.
     *
     * @var list<string>
     */
    public const RESERVED = ['fuel.governance.manage', 'fuel.staff.manage'];

    /** @var list<string> */
    private const SELLER_KEYS = [
        'fuel_stations.view',
        'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.close', 'fuel.shift.cash_count',
    ];

    /** @var list<string> */
    private const SUPERVISOR_EXTRA = [
        'fuel.shift.approve', 'fuel.shift.cash_variance_review',
        'fuel.sale.view',
        'fuel.delivery.view', 'fuel.delivery.create',
        'fuel.reading.view', 'fuel.reading.record',
        'fuel.reconciliation.view', 'fuel.reconciliation.create',
        'fuel.supplier_invoice.view',
        'fuel.alerts.view', 'fuel.reports.view',
    ];

    /** @var list<string> */
    private const MANAGER_EXTRA = [
        'fuel.delivery.approve', 'fuel.reconciliation.approve',
        'fuel.sale.create', 'fuel.sale.finalize', 'fuel.sale.collect',
        'fuel.alerts.manage',
        'fuel.maintenance.view', 'fuel.safety.view', 'fuel.device.view',
    ];

    /** @return array<string, array{label_ar: string, label_en: string, permissions: list<string>}> */
    public static function all(): array
    {
        $supervisor = self::sorted([...self::SELLER_KEYS, ...self::SUPERVISOR_EXTRA]);

        return [
            self::SELLER => ['label_ar' => 'بائع', 'label_en' => 'Attendant', 'permissions' => self::sorted(self::SELLER_KEYS)],
            self::SUPERVISOR => ['label_ar' => 'مشرف', 'label_en' => 'Supervisor', 'permissions' => $supervisor],
            self::STATION_MANAGER => ['label_ar' => 'مدير محطة', 'label_en' => 'Station manager', 'permissions' => self::sorted([...$supervisor, ...self::MANAGER_EXTRA])],
        ];
    }

    /** @return list<string>|null */
    public static function permissions(string $template): ?array
    {
        return self::all()[$template]['permissions'] ?? null;
    }

    /** مفتاح من مجال الوقود (تُدار بهذه الخدمة)؟ غيره يُحفظ كما هو في الدور الشخصي ولا يُمنح ولا يُسحب. */
    public static function isFuelDomain(string $permission): bool
    {
        return str_starts_with($permission, 'fuel.') || str_starts_with($permission, 'fuel_stations.');
    }

    /** @return list<string> كل مفاتيح الوقود المعروفة (الكتالوج القانوني). */
    public static function catalog(): array
    {
        return self::sorted(array_values(array_filter(Rbac::PERMISSIONS, fn (string $p) => self::isFuelDomain($p))));
    }

    /**
     * «كل صلاحيات الوقود» المسموح للفاعل بتفويضها: الكتالوج ∩ ما يملكه الفاعل − المفاتيح المحجوزة. حامل `*` يحصل على الكتالوج كله عدا المحجوزة.
     *
     * @param  list<string>  $actorPermissions
     * @return list<string>
     */
    public static function grantableAll(array $actorPermissions): array
    {
        $catalog = array_values(array_diff(self::catalog(), self::RESERVED));
        if (in_array('*', $actorPermissions, true)) {
            return $catalog;
        }

        return array_values(array_intersect($catalog, $actorPermissions));
    }

    /**
     * @param  list<string>  $keys
     * @return list<string>
     */
    public static function sorted(array $keys): array
    {
        $keys = array_values(array_unique($keys));
        sort($keys);

        return $keys;
    }
}
