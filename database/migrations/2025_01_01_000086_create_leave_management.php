<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * الإجازات — نطاق البناء الأول (design-system/foundations/
 * hr-users-architecture.md «الإجازات»): «نوع إجازة» فقط + رصيدٌ مباشر
 * (مُحتسَبٌ لا مُخزَّن — انظر LeaveType::balanceFor())، بلا طبقة «سياسة إجازة»
 * منفصلة وبلا قوائم عطلات تلقائية — كلاهما مؤجَّلٌ صراحةً لتمريرٍ لاحق
 * (القرار المعتمد). **بلا أثرٍ مالي آلي على الرواتب** — الإجازة بيانات
 * موافقة/رصيد فقط، لا تستدعي LedgerService ولا تمسّ PayrollService (القرار
 * المعتمد الثاني).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leave_types', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->boolean('is_paid')->default(true);
            $table->unsignedInteger('annual_days')->default(0); // الرصيد السنوي المستحق (أيام)
            $table->boolean('requires_approval')->default(true);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'name']);
        });

        Schema::create('leave_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('leave_type_id')->constrained('leave_types')->restrictOnDelete();
            $table->date('start_date');
            $table->date('end_date');
            $table->unsignedInteger('days_count'); // مشتقٌّ من start/end وقت الإنشاء، لا مُدخَلٌ يدوياً
            $table->string('status')->default('pending'); // pending|approved|rejected|cancelled
            $table->text('reason')->nullable();
            $table->text('rejection_reason')->nullable();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'employee_id']);
            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_requests');
        Schema::dropIfExists('leave_types');
    }
};
