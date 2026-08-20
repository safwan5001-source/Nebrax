<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * حقول امتثال/تشغيل حقيقية غائبة عن سجلّ الموظف، مقارنةً بنموذج دفترة
     * (design-system/foundations/hr-users-architecture.md). كلّها **اختيارية**
     * فلا يُكسَر أيّ موظفٍ قائم عند الترقية.
     *
     * **مؤجَّل عمداً من هذه الدفعة** (زخرفة/نطاق مستقبلي لا قيمة امتثال فورية):
     * صورة الموظف، العنوانان الكامِلان (١٤ حقلاً)، جهة الحجز، السنة المالية
     * المخصَّصة، مصدر الحضور، قوائم الرواتب، سياسة الإجازات (تحتاج وحدة كاملة).
     */
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            // تجزئة الاسم — تكميلية لعمود `name` القائم (يبقى هو مصدر العرض)،
            // مطلوبة رسمياً لملفات التحويل البنكي/GOSI التي تفصل الاسم لحقول.
            $table->string('first_name')->nullable()->after('name');
            $table->string('middle_name')->nullable()->after('first_name');
            $table->string('last_name')->nullable()->after('middle_name');

            // الجنسية + انتهاء الإقامة: أساس تصنيف السعودة/GOSI وتنبيه التجديد
            // للموظف غير السعودي. حقلان نصّيان بلا قائمة جنسيات مقفلة (سياسة
            // إدخال حرّ تكفي اليوم؛ قائمة منظَّمة تُبنى إن احتيج لاحقاً).
            $table->string('nationality')->nullable()->after('national_id');
            $table->date('residency_expiry_date')->nullable()->after('nationality');

            // تواصل شخصي — غائب كلياً اليوم؛ لا يتقاطع مع `users.email` (بريد
            // الدخول)، فهذا بريد الموظف الشخصي بصفته سجلّ موارد بشرية.
            $table->string('phone')->nullable()->after('residency_expiry_date');
            $table->string('personal_email')->nullable()->after('phone');

            // معلومات عمل إضافية.
            $table->string('department')->nullable()->after('job_title');
            $table->string('employment_type')->nullable()->after('department');

            // المدير المباشر — علاقة ذاتية داخل نفس الجدول. `nullOnDelete`: حذف
            // المدير يفكّ الربط عن مرؤوسيه بدل رفض الحذف أو حذفهم معه.
            $table->foreignUuid('manager_id')->nullable()->after('employment_type')
                ->constrained('employees')->nullOnDelete();

            // الوردية الافتراضية — تُقترَح عند تسجيل حضور الموظف؛ لا تُلزم سطور
            // الحضور القائمة بها (كل سطرٍ يختار ورديته كما اليوم).
            $table->foreignUuid('shift_id')->nullable()->after('manager_id')
                ->constrained('shifts')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropConstrainedForeignId('manager_id');
            $table->dropConstrainedForeignId('shift_id');
            $table->dropColumn([
                'first_name', 'middle_name', 'last_name',
                'nationality', 'residency_expiry_date',
                'phone', 'personal_email',
                'department', 'employment_type',
            ]);
        });
    }
};
