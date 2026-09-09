<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  PR-DUR-1 — أساس بنية الاستيراد الدائم (Durable Imports)
     * ═══════════════════════════════════════════════════════════════
     *  هوية دائمة ومملوكة للمستأجر لملف مرفوع وتشغيلته، قبل أي معالجة
     *  مجزّأة أو ربط بمجال فعلي (كتالوج المنتجات، المصنّف، الرصيد
     *  الافتتاحي). لا يمسّ هذا الجدول أي جدول قائم ولا يُستهلك من أي
     *  مسار استيراد حالي — إضافي بالكامل.
     *
     *  `status` يحمل كامل مفردات الحالة (بما فيها queued/processing/
     *  completed غير القابلة للوصول بعد) كي لا تحتاج PR-DUR-2 هجرة عمود
     *  جديدة لمجرّد توسعة enum؛ التفصيل في DURABLE-IMPORTS-DECOMPOSITION.md §4.
     *
     *  مشترك عن قصد لا عن إغفال (`CompanyWide`): تشغيلة استيراد عملية
     *  على مستوى المؤسسة كلها، لا فرعاً بعينه — تماماً كـ`barcode_registry`
     *  و`product_barcodes`.
     */
    public function up(): void
    {
        Schema::create('import_jobs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();

            $table->string('domain', 64);
            $table->string('status', 32)->default('uploaded');

            // فحص تكرار الإرسال على مستوى إنشاء التشغيلة فقط (لا على مستوى
            // الصفوف — ذاك عقد PR-DUR-2). NULL متعدد مسموح؛ التفرّد فقط حين
            // يُرسِل العميل مفتاحاً فعلياً.
            $table->string('idempotency_key', 191)->nullable();

            $table->string('original_filename', 255);
            $table->string('extension', 10);
            $table->string('mime_type', 191)->nullable();
            $table->unsignedBigInteger('byte_size');
            $table->string('storage_disk', 32);
            // يُصفَّر عند الإلغاء/التقليم بعد حذف الملف فعلياً — السجل يبقى للتدقيق.
            $table->string('storage_path', 512)->nullable();
            $table->char('content_sha256', 64);

            $table->unsignedInteger('row_count')->nullable();
            $table->unsignedInteger('column_count')->nullable();
            $table->text('error_message')->nullable();

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamp('queued_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('purge_after')->nullable();

            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'domain']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('import_jobs');
    }
};
