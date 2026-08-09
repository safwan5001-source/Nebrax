<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // الفرع الرئيسي يصير عموداً حقيقياً بدل قيمة داخل JSON.
        //
        // العلّة التي يُصلحها: تخزينه في `tenants.settings` بلا قيد سلامة يجعله
        // عرضةً للضياع الصامت (معرّف معلّق بعد الحذف، أو كاتب إعدادات يمسحه)،
        // وحينها يصير **أول فرع يُضاف** رئيسياً تلقائياً — وهو العَرَض المُبلَّغ.
        // العمود + قيد «واحد فقط» ينهي الصنف كلّه لا الحالة الواحدة.
        // ═══════════════════════════════════════════════════════
        Schema::table('branches', function (Blueprint $table) {
            $table->boolean('is_main')->default(false)->after('name');
        });

        // ترحيل بلا فقد: القيمة القائمة في JSON تصير العمود.
        foreach (DB::table('tenants')->select('id', 'settings')->get() as $tenant) {
            $settings = json_decode($tenant->settings ?? '{}', true) ?: [];
            $mainId   = $settings['branches']['main_branch_id'] ?? null;

            // المعرّف المحفوظ إن كان لا يزال فرعاً قائماً لهذا المستأجر،
            // وإلا أقدم فرع له (فلا تبقى مؤسسة بلا فرع رئيسي).
            $target = $mainId
                ? DB::table('branches')->where('tenant_id', $tenant->id)->where('id', $mainId)->value('id')
                : null;

            $target ??= DB::table('branches')->where('tenant_id', $tenant->id)
                ->orderBy('code')->value('id');

            if ($target) {
                DB::table('branches')->where('id', $target)->update(['is_main' => true]);
            }
        }

        // فهرس جزئي يفرض «فرع رئيسي واحد لكل مستأجر» على مستوى القاعدة.
        // PostgreSQL يدعم الفهرس الجزئي؛ SQLite يدعمه أيضاً (3.8+).
        DB::statement('CREATE UNIQUE INDEX branches_one_main_per_tenant ON branches (tenant_id) WHERE is_main = true');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS branches_one_main_per_tenant');

        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn('is_main');
        });
    }
};
