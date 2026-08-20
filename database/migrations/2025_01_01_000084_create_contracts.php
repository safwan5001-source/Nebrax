<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * عقود الموظفين — الراتب يتبع العقد لا حقول Employee الثابتة
 * (design-system/foundations/hr-users-architecture.md «القرار النهائي — الراتب يتبع العقد»).
 * هجرة تلقائية: عقدٌ دائم افتراضي لكل موظف قائم براتبه الحالي، بداية من
 * تاريخ توظيفه (أو إنشائه)، كي لا يُستبعد أي موظف قائم من أول مسيّر رواتب
 * بعد الترقية. حقول Employee القديمة (basic_salary وأخواتها) تبقى في القاعدة
 * دون حذف — مصدر هذه الهجرة فقط من الآن فصاعداً، لا مصدر حقيقة تشغيلي.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contracts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('employee_id')->constrained()->cascadeOnDelete();
            $table->string('type')->default('permanent'); // permanent|fixed_term|probation
            $table->string('status')->default('active');  // active|ended|terminated
            $table->date('start_date');
            $table->date('end_date')->nullable();
            $table->date('probation_end_date')->nullable();
            $table->bigInteger('basic_salary')->default(0);
            $table->bigInteger('allowances')->default(0);
            $table->bigInteger('gosi')->default(0);
            $table->bigInteger('other_deductions')->default(0);
            $table->text('notes')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'employee_id']);
            $table->index(['tenant_id', 'employee_id', 'start_date']);
        });

        $this->backfill();
    }

    private function backfill(): void
    {
        DB::table('employees')->orderBy('id')->chunk(200, function ($employees) {
            $now = now();
            $rows = $employees->map(fn ($employee) => [
                'id'                 => (string) Str::uuid(),
                'tenant_id'          => $employee->tenant_id,
                'employee_id'        => $employee->id,
                'type'               => 'permanent',
                'status'             => 'active',
                'start_date'         => $employee->hire_date ?? Carbon::parse($employee->created_at)->toDateString(),
                'end_date'           => null,
                'probation_end_date' => null,
                'basic_salary'       => $employee->basic_salary ?? 0,
                'allowances'         => $employee->allowances ?? 0,
                'gosi'               => $employee->gosi ?? 0,
                'other_deductions'   => $employee->other_deductions ?? 0,
                'notes'              => null,
                'created_by'         => null,
                'created_at'         => $now,
                'updated_at'         => $now,
            ])->all();

            if ($rows !== []) {
                DB::table('contracts')->insert($rows);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contracts');
    }
};
