<?php

namespace App\Support;

use App\Models\User;

/**
 * FUEL-B5.1: من يحق له **تسجيل** تكلفة استلام وقود (كتابة) — مستقل عن إنشاء الاستلام واعتماده.
 *
 * السلطة = صلاحية مالية دقيقة (`fuel.delivery.cost.record`، أو القديمة الأوسع `fuel_stations.manage` توافقاً رجعياً كمفاتيح B2)
 * **و** `products.view_cost` (سياسة التكلفة الحسّاسة المركزية). المفتاح الدقيق وحده لا يكفي، ولا `view_cost` وحدها: فمن يرى التكلفة
 * لا يكتبها بالضرورة، ومن يكتبها لا بدّ أن يراها (لا كتابة عمياء). `owner`/`admin` عبر `*`.
 * هذا ما يطبّقه الخادم في مسار الكتابة؛ وإخفاء الواجهة لا يُعتمد عليه.
 */
final class FuelDeliveryCostAuthority
{
    public const PERMISSION = 'fuel.delivery.cost.record';

    public static function canRecord(?User $user): bool
    {
        if ($user === null || ! SensitiveCostPolicy::authorized($user)) {
            return false;
        }

        return Rbac::allows((string) $user->role, self::PERMISSION) || Rbac::allows((string) $user->role, 'fuel_stations.manage');
    }
}
