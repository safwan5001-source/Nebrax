<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * يوسّع سند القبض ببيانات التحصيل التي لا تغيّر القيد، ويحفظ مرفقاته
     * الخاصة على جدول تابع. حالة السند تبقى المصدر الوحيد لحقيقة المسودة
     * والترحيل؛ لا يوجد حقل حالة دفع موازٍ.
     */
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->foreignUuid('collector_employee_id')->nullable()->after('created_by')
                ->constrained('employees')->nullOnDelete();
            $table->string('payment_details', 1000)->nullable()->after('reference');
            $table->index(['tenant_id', 'collector_employee_id']);
        });

        Schema::create('payment_attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('payment_id')->constrained('payments')->cascadeOnDelete();
            $table->string('disk');
            $table->string('path');
            $table->string('original_name');
            $table->string('mime_type', 100)->nullable();
            $table->unsignedBigInteger('size');
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'payment_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_attachments');

        Schema::table('payments', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'collector_employee_id']);
            $table->dropConstrainedForeignId('collector_employee_id');
            $table->dropColumn('payment_details');
        });
    }
};
