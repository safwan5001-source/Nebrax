<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // الموظفون (Employees)
        // الرواتب بالـ minor units (هللات) كـ bigint — لا float.
        // الإجمالي (gross) = الراتب الأساسي + البدلات.
        // ═══════════════════════════════════════════════════════
        Schema::create('employees', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('employee_no');                       // EMP-00001
            $table->string('name');
            $table->string('national_id')->nullable();
            $table->string('job_title')->nullable();
            $table->bigInteger('basic_salary')->default(0);      // الراتب الأساسي (هللات)
            $table->bigInteger('allowances')->default(0);        // البدلات (هللات)
            $table->date('hire_date')->nullable();
            $table->boolean('is_active')->default(true);
            $table->string('notes')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'employee_no']);
            $table->index(['tenant_id', 'is_active']);
        });

        // ═══════════════════════════════════════════════════════
        // مسيّرات الرواتب الشهرية (Payroll Runs) — رأس المسيّر
        // الدورة: draft → posted (ترحيل الاستحقاق) → paid (الصرف).
        // ═══════════════════════════════════════════════════════
        Schema::create('payroll_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                            // PR-2025-00001
            $table->string('period');                            // 2025-06 (YYYY-MM)
            $table->date('period_start');
            $table->date('period_end');
            $table->enum('status', ['draft', 'posted', 'paid'])->default('draft');
            $table->enum('pay_method', ['cash', 'bank'])->nullable(); // يُحدَّد عند الصرف
            $table->bigInteger('total_gross')->default(0);
            $table->bigInteger('total_net')->default(0);
            $table->string('notes')->nullable();
            // قيد الاستحقاق (مدين 5120 / دائن 2130) عند الترحيل
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            // قيد الصرف (مدين 2130 / دائن 1110|1120) عند الدفع
            $table->foreignUuid('payment_journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'period']);
        });

        // سطور المسيّر — لقطة راتب كل موظف لحظة إنشاء المسيّر
        Schema::create('payroll_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payroll_run_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('employee_id')->constrained('employees')->restrictOnDelete();
            $table->bigInteger('basic_salary')->default(0);
            $table->bigInteger('allowances')->default(0);
            $table->bigInteger('gross')->default(0);             // الأساسي + البدلات
            $table->bigInteger('net')->default(0);               // الصافي (= gross في MVP)
            $table->timestamps();

            $table->index(['tenant_id', 'payroll_run_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_items');
        Schema::dropIfExists('payroll_runs');
        Schema::dropIfExists('employees');
    }
};
