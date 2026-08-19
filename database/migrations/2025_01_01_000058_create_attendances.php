<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  الحضور والانصراف (Attendance) — تمام الوحدة الثانية
     * ═══════════════════════════════════════════════════════════════
     *  سجلّ حضورٍ يومي للموظف: تسجيل دخول/خروج، حالة، ووردية اختيارية.
     *  ساعات العمل الفعلية **مشتقّة لا مخزَّنة** (`Attendance::workedMinutes`،
     *  يعالج الخروج بعد منتصف الليل).
     *
     *  **التصنيف: `BranchScoped`** — وفق مرجع دفترة المعتمَد وقسم ٥ من
     *  `hr-users-architecture.md`: الحضور عملٌ يوميٌّ في فرعٍ تشغيلي فعلي،
     *  فيُعزل به (خلافاً لسجلّ الموظف المركزي `CompanyWide`).
     *
     *  المفاتيح الأجنبية مباشرة (إنشاء جدولٍ جديد لا ALTER، فلا إعادة بناء
     *  SQLite ولا فهرسَ جزئي يُفقد): `employee_id` لسجلّ الموظف، و`shift_id`
     *  اختياري للوردية.
     *
     *  القيد الفريد `(tenant_id, branch_id, employee_id, attendance_date)`:
     *  سجلٌّ واحد لكل موظفٍ في اليوم لكل فرع. `branch_id = null` لا يُقيَّد
     *  (NULL ≠ NULL في الفهارس) — حالة ما قبل الفروع.
     */
    public function up(): void
    {
        Schema::create('attendances', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->foreignUuid('shift_id')->nullable()->constrained('shifts')->nullOnDelete();
            $table->date('attendance_date');
            $table->time('check_in')->nullable();
            $table->time('check_out')->nullable();
            $table->string('status')->default('present'); // present | absent | late | leave
            $table->string('notes')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'employee_id', 'attendance_date'], 'attendances_daily_unique');
            $table->index(['tenant_id', 'attendance_date']);
            $table->index(['tenant_id', 'branch_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendances');
    }
};
