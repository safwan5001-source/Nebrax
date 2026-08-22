<?php

use App\Support\Rbac;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * بوابة الخدمة الذاتية للموظف — دورٌ نظامي خامس (`self_service`) إضافةً
     * إلى الأربعة المزروعة وقت التسجيل (`AuthController::register`).
     *
     * التسجيل الجديد يلتقط الدور تلقائياً عبر `Rbac::systemRoles()`؛ هذه
     * الهجرة تُبكفِّئ (backfill) المستأجرين القائمين فقط، فيظهر الدور في
     * شاشة الأدوار وقائمة اختيار دور المستخدم دون انتظار حدثٍ آخر.
     *
     * `StoreUserRequest::rules()` يتحقّق من `role` كصفٍّ في جدول `roles` لا
     * سقوطاً على `Rbac::MATRIX` — فبلا هذا البكفئة يبقى الدور غير قابلٍ
     * للإسناد فعلياً للمستأجرين القائمين رغم وجوده في المصفوفة الثابتة.
     */
    public function up(): void
    {
        $role = Rbac::systemRoles()['self_service'];
        $now = now();

        $tenantIds = DB::table('tenants')->pluck('id');

        foreach ($tenantIds as $tenantId) {
            $exists = DB::table('roles')
                ->where('tenant_id', $tenantId)
                ->where('slug', 'self_service')
                ->exists();

            if ($exists) {
                continue;
            }

            DB::table('roles')->insert([
                'id'          => (string) Str::uuid(),
                'tenant_id'   => $tenantId,
                'slug'        => 'self_service',
                'name'        => $role['name'],
                'permissions' => json_encode($role['permissions']),
                'is_system'   => true,
                'created_at'  => $now,
                'updated_at'  => $now,
            ]);
        }
    }

    public function down(): void
    {
        DB::table('roles')->where('slug', 'self_service')->where('is_system', true)->delete();
    }
};
