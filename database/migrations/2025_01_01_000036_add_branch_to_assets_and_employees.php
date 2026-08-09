<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * الموجة الثانية (P3-ب) — عمودان بدلالتين مختلفتين عمداً:
     *
     *  • `assets.branch_id`    → عزل حقيقي (BranchScoped): الأصل يخصّ موقعاً بعينه.
     *  • `employees.branch_id` → **حقل وصفي فقط** (BelongsToBranch): «مكان العمل».
     *    الموظفون والرواتب مركزيّون على مستوى المؤسسة — لا حاجز عزل بينهم.
     *
     * `payroll_runs` بلا عمود إطلاقاً: مركزية بالكامل (CompanyWide).
     */
    private const TABLES = ['assets', 'employees'];

    public function up(): void
    {
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
