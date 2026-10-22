<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-H1-S8a — نتائج الوحدات الفاشلة لتشغيلات الاستيراد الدائم (أساس الإصلاح العام).
 *
 * لا يُخزَّن سطرٌ للوحدات الناجحة (مراجعتها بعدّادات `import_jobs`)؛ تُخزَّن الوحدات **الفاشلة وغير المنجزة** فقط، كل واحدة بمعرّف
 * مصدرٍ ثابت `source_unit_ref` (UUID مشتقّ حتمياً من معرّف التشغيلة وترتيب الوحدة — لا يعتمد على مفتاح العمل كالرمز SKU فيمكن
 * تصحيحه أو ملؤه عند الإصلاح). `status`: `failed` ثم `repaired` (S8b) — الانتقال الشرطيّ الوحيد `failed → repaired`.
 *
 * إضافيٌّ بالكامل: جدول جديد بلا Backfill ولا مَسّ لأي جدول قائم. مشترك على مستوى المؤسسة (`CompanyWide`) كـ`import_jobs`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('import_job_units', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('import_job_id')->constrained('import_jobs')->cascadeOnDelete();

            $table->uuid('source_unit_ref');
            // ترتيب الوحدة بين صفوف البيانات الفعلية (يبدأ من 0، بلا العناوين ولا الفارغة) — تعريف المحرّك نفسه لـ`processed_rows`.
            $table->unsignedInteger('unit_ordinal');
            $table->string('status', 16)->default('failed');
            $table->string('error_code', 64);
            $table->text('error_message')->nullable();
            $table->uuid('repaired_by_job_id')->nullable();

            $table->timestamps();

            $table->unique(['import_job_id', 'source_unit_ref']);
            $table->unique(['import_job_id', 'unit_ordinal']);
            $table->index(['tenant_id', 'import_job_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('import_job_units');
    }
};
