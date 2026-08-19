<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  ورديات العمل (Shifts) — الوحدة الثانية من معمار الموارد البشرية
     * ═══════════════════════════════════════════════════════════════
     *  (design-system/foundations/hr-users-architecture.md)
     *
     *  الوردية تعريفُ جدولٍ زمني: بداية، نهاية، استراحة، وأيام عمل. صافي
     *  ساعاتها **مشتقّ لا مخزَّن** (يُحسب من الأوقات في `Shift::netMinutes`).
     *
     *  **التصنيف: `BranchScoped`** — وفق مرجع دفترة المعتمَد: خلافاً لسجلّ
     *  الموظف المركزي (`CompanyWide`)، وردية العمل مرتبطة بفرعٍ تشغيلي فعلي،
     *  فتُعزل بالفرع (كل فرع يرى ورديّاته). لذا `branch_id` + فهرس
     *  `(tenant_id, branch_id)` — نفس متطلّب أي كيان `BranchScoped`.
     *  ووردية `branch_id = null` مشترَكة تُرى من كل الفروع.
     */
    public function up(): void
    {
        Schema::create('shifts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // وسم وصفي (مكان تشغيل الوردية) — لا يعزل. nullable = بلا فرع محدَّد.
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('name');
            $table->time('start_time');
            $table->time('end_time');
            $table->unsignedInteger('break_minutes')->default(0); // دقائق الاستراحة
            $table->json('work_days');                            // أيام العمل [0..6]، 0=الأحد
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index('tenant_id');
            $table->index(['tenant_id', 'branch_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shifts');
    }
};
