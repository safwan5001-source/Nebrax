<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * إدارة الطلبات — نطاق البناء الأول (design-system/foundations/
 * hr-users-architecture.md «إدارة الطلبات»): أنواع طلبات ثابتة (كيانٌ مُدار
 * قابل للتوسعة اسماً) بحقول موحّدة للسجلّ نفسه — لا محرّك حقول ديناميكية لكل
 * نوع (خلافاً لنموذج دفترة الكامل). سير موافقة أحادي المستوى، نفس نمط
 * `leave_requests` تماماً. `leave_requests` تبقى وحدةً منفصلة عمداً (قرارٌ
 * معتمد) — لا تُدمَج ضمن هذا المحرّك العام.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('request_types', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->boolean('requires_approval')->default(true);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'name']);
        });

        Schema::create('employee_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('request_type_id')->constrained('request_types')->restrictOnDelete();
            $table->string('title');
            $table->text('description')->nullable();
            $table->date('requested_date')->nullable(); // تاريخٌ عامٌّ ذو صلة (اختياري بحسب نوع الطلب)
            $table->string('status')->default('pending'); // pending|approved|rejected|cancelled
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
        Schema::dropIfExists('employee_requests');
        Schema::dropIfExists('request_types');
    }
};
