<?php

namespace App\Support;

/**
 * مصفوفة صلاحيات الأدوار (RBAC).
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
            'accounts.view', 'reports.view', 'zatca.view',
        ],
        'staff' => [
            'partners.view', 'products.view', 'invoices.view',
            'payments.view', 'purchases.view', 'returns.view',
            'hr.view', 'expenses.view',
            'accounts.view', 'reports.view', 'zatca.view',
        ],
    ];

    public static function allows(string $role, string $permission): bool
    {
        $perms = self::MATRIX[$role] ?? [];

        return in_array('*', $perms, true) || in_array($permission, $perms, true);
    }
}
