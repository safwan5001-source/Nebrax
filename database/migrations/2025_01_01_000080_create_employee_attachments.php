<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * مسوّغات تعيين الموظف (هوية، شهادات، عقود ممسوحة…) — مرفقات متعددة لكل
 * موظف. تتبع تصنيف `Employee` نفسه (`CompanyWide` + `BelongsToBranch` وصفياً)
 * لا تصنيفاً مستقلاً، اتساقاً مع نمط مرفقات المصروفات/سندات القبض القائم.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->string('disk');
            $table->string('path');
            $table->string('original_name');
            $table->string('mime_type', 100)->nullable();
            $table->unsignedBigInteger('size');
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'employee_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_attachments');
    }
};
