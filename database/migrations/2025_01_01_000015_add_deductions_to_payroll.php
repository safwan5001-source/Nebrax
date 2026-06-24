<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // استقطاعات الرواتب: GOSI (حصة الموظف) + استقطاعات أخرى (سُلف…)
        // كلها بالـ minor units (هللات) كـ bigint — لا float.
        // الصافي = الإجمالي − GOSI − الاستقطاعات الأخرى.
        // ═══════════════════════════════════════════════════════
        Schema::table('employees', function (Blueprint $table) {
            $table->bigInteger('gosi')->default(0)->after('allowances');             // حصة الموظف الشهرية
            $table->bigInteger('other_deductions')->default(0)->after('gosi');       // سُلف/استقطاعات أخرى
        });

        Schema::table('payroll_runs', function (Blueprint $table) {
            $table->bigInteger('total_gosi')->default(0)->after('total_gross');
            $table->bigInteger('total_other_deductions')->default(0)->after('total_gosi');
        });

        Schema::table('payroll_items', function (Blueprint $table) {
            $table->bigInteger('gosi')->default(0)->after('allowances');
            $table->bigInteger('other_deductions')->default(0)->after('gosi');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn(['gosi', 'other_deductions']);
        });
        Schema::table('payroll_runs', function (Blueprint $table) {
            $table->dropColumn(['total_gosi', 'total_other_deductions']);
        });
        Schema::table('payroll_items', function (Blueprint $table) {
            $table->dropColumn(['gosi', 'other_deductions']);
        });
    }
};
