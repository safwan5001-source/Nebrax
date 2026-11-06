<?php

namespace App\Support;

/**
 * سقف صلاحيات إصدار مفاتيح Public API (AIA-0.4 / D-08) — **دالة نقية** بلا قاعدة بيانات.
 *
 * المبدأ: لا يستطيع مُصدِر المفتاح منح scope يقابل صلاحية RBAC لا يملكها هو. كل scope
 * يُسقَط على صلاحيته عبر `PublicApiScope::permission()`، ويُقارَن بصلاحيات المُصدِر الفعلية
 * بالمقارنة نفسها المعتمدة لسقف منح الأدوار (`Rbac::covers`): حاملُ `*` (owner/admin)
 * يغطّي كل شيء، وغيره لا يغطّي إلا ما يملكه حرفياً.
 *
 * فشل مغلق: scope مجهول يُعدّ ممنوعاً. لا يقرأ هذا الصنف ولا يكتب أي شيء.
 */
final class PublicApiScopeCeiling
{
    /**
     * الـ scopes (من المطلوبة) التي لا تغطيها صلاحيات المُصدِر. فارغ = مسموح كلها.
     *
     * @param  array<int, string>  $holderPermissions
     * @param  array<int, string>  $scopes
     * @return list<string>
     */
    public static function denied(array $holderPermissions, array $scopes): array
    {
        $denied = [];

        foreach ($scopes as $scope) {
            $case = PublicApiScope::tryFrom((string) $scope);

            if ($case === null || ! Rbac::covers($holderPermissions, [$case->permission()])) {
                $denied[(string) $scope] = (string) $scope;
            }
        }

        return array_values($denied);
    }

    /**
     * كل الـ scopes المعروفة التي يجوز لهذا المُصدِر منحها (للعرض في الواجهة).
     *
     * @param  array<int, string>  $holderPermissions
     * @return list<string>
     */
    public static function issuable(array $holderPermissions): array
    {
        $all = PublicApiScope::all();
        $denied = array_flip(self::denied($holderPermissions, $all));

        return array_values(array_filter($all, static fn (string $scope): bool => ! isset($denied[$scope])));
    }
}
