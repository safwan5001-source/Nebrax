<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  المصروفات — تصنيف مُدار ومرفقات مستند
     * ═══════════════════════════════════════════════════════════════
     *
     * التصنيف تسمية تشغيلية وتحليلية فقط: حساب المصروف يظل مصدر الأثر
     * المحاسبي. لذلك لا يُنشئ التصنيف قيداً ولا يغير الحساب المدين عند الترحيل.
     *
     * المرفق يسير مع مستند المصروف ويبقى منفصلاً عنه: لا يُعدّل المستند
     * المرحّل ولا يُخزّن مسار ملف غير موثوق ضمن حمولة JSON.
     */
    public function up(): void
    {
        Schema::create('expense_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('name');
            $table->string('description', 1000)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'branch_id', 'is_active']);
        });

        Schema::table('expenses', function (Blueprint $table) {
            $table->foreignUuid('category_id')->nullable()->after('account_id')
                ->constrained('expense_categories')->nullOnDelete();
            $table->string('vendor_name')->nullable()->after('partner_id');
            $table->index(['tenant_id', 'category_id']);
        });

        Schema::create('expense_attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('expense_id')->constrained('expenses')->cascadeOnDelete();
            $table->string('disk');
            $table->string('path');
            $table->string('original_name');
            $table->string('mime_type', 100)->nullable();
            $table->unsignedBigInteger('size');
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'expense_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('expense_attachments');

        Schema::table('expenses', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'category_id']);
            $table->dropConstrainedForeignId('category_id');
            $table->dropColumn('vendor_name');
        });

        Schema::dropIfExists('expense_categories');
    }
};
