<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  ربط المستخدم بالموظف — تجسيد `User ⊃ Employee`
     * ═══════════════════════════════════════════════════════════════
     *  المرجع الوظيفي (دفترة) والقرار المعماري في
     *  `design-system/foundations/hr-users-architecture.md`:
     *  **المستخدم موظفٌ يدخل النظام.** فحساب الدخول طبقةٌ اختيارية فوق سجلّ
     *  الموظف، لا كيانٌ منفصل عنه.
     *
     *  `employee_id` **اختياري** (nullable) حفاظاً على التوافق الرجعي:
     *  المستخدمون القائمون (المالك الأول تحديداً) بلا سجلّ موظف، ولا يجوز أن
     *  يُكسَروا بترقية. ومن ثمّ يبقى إنشاء مستخدمٍ بلا موظف ممكناً كما هو اليوم.
     *
     *  **فريدٌ:** موظفٌ واحد ↔ حساب دخول واحد على الأكثر. والقيم الفارغة
     *  المتعددة مسموحة في الفهرس الفريد (`NULL ≠ NULL`) على SQLite وPostgres،
     *  فلا يتصادم مستخدمان بلا موظف.
     *
     *  المفتاح الأجنبي `nullOnDelete`: حذف سجلّ الموظف يفكّ الربط ولا يحذف
     *  حساب الدخول (قد يبقى للتاريخ أو يُعاد ربطه). و`users` ليس من جداول
     *  الترقيم بالفرع، فلا فهرس جزئي يُفقد بإعادة بناء SQLite هنا.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignUuid('employee_id')->nullable()->after('tenant_id')
                ->constrained('employees')->nullOnDelete();
            $table->unique('employee_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['employee_id']);
            $table->dropConstrainedForeignId('employee_id');
        });
    }
};
