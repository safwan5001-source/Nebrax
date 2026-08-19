<?php

use App\Support\Rbac;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * أدوار الصلاحيات — من ثابتٍ في الكود (`Rbac::MATRIX`) إلى جدولٍ قابل للضبط
     * لكل مؤسسة. **`CompanyWide`**: الأدوار تخصّ المؤسسة كلها لا فرعاً بعينه.
     *
     * `slug` مفتاح الدور الذي يشير إليه `users.role` (لا هجرة لصفوف المستخدمين).
     * `is_system` يحمي الأدوار الأربعة الأصلية من الحذف. `permissions` مصفوفة
     * صلاحيات؛ `["*"]` تعني كل الصلاحيات (owner/admin).
     *
     * **التوافق الرجعي إلزامي:** تُزرع الأدوار الأربعة الحالية حرفياً من
     * `Rbac::MATRIX` لكل مستأجرٍ قائم، فلا يتغيّر سلوك أي مستخدمٍ يوم التفعيل.
     */
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('slug');
            $table->string('name');
            $table->json('permissions');
            $table->boolean('is_system')->default(false);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'slug']);
            $table->index(['tenant_id', 'is_system']);
        });

        // تعبئة المستأجرين القائمين بالأدوار النظامية — نسخةً طبق الأصل من
        // المصفوفة الثابتة، فيبقى السلوك متطابقاً حتى يعدّل المالك دوراً.
        foreach (DB::table('tenants')->pluck('id') as $tenantId) {
            foreach (Rbac::systemRoles() as $slug => $role) {
                DB::table('roles')->insert([
                    'id'          => (string) Str::uuid(),
                    'tenant_id'   => $tenantId,
                    'slug'        => $slug,
                    'name'        => $role['name'],
                    'permissions' => json_encode($role['permissions']),
                    'is_system'   => true,
                    'created_at'  => now(),
                    'updated_at'  => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('roles');
    }
};
