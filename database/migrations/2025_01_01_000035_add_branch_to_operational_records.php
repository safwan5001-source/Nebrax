<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * الموجة الأولى من العزل التشغيلي بالفرع (P3-أ): سجلات غير محاسبية بحتة.
     * لا تولّد قيوداً ولا يعتمد عليها محرك التقييم، فعزلها لا يمسّ أي حساب.
     */
    private const TABLES = [
        'appointments', 'contacts', 'crm_activities', 'recurring_invoices',
    ];

    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // عمود nullable + فهرس (tenant_id, branch_id) — إضافة غير كاسرة:
        // الصفوف القائمة تبقى بـ null، و BranchScope يعتبر null «مشتركاً»
        // فتظلّ مرئية لكل الفروع (لا تختفي بيانات عند تفعيل العزل).
        // ═══════════════════════════════════════════════════════
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('branch_id')->nullable()
                    ->constrained('branches')->nullOnDelete();
                $table->index(['tenant_id', 'branch_id']);
            });
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::TABLES) as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('branch_id');
            });
        }
    }
};
