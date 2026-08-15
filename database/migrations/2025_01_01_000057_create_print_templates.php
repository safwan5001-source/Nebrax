<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ═══════════════════════════════════════════════════════════════
 *  قوالب الطباعة — تعريف قابل للنشر، مراجعة ثابتة، وتعيين بحسب المستند/الفرع
 * ═══════════════════════════════════════════════════════════════
 *
 * الإعداد السابق `tenants.settings.sales_config.designs` كائن واحد للفواتير:
 * لا اسم له ولا تاريخ ولا مراجعات ولا تعيين مختلف للمستندات. هذا الترحيل
 * يرفعه إلى ثلاث حقائق منفصلة:
 *
 *  1. `print_templates`: هوية القالب ومكتبته على مستوى المؤسسة.
 *  2. `print_template_revisions`: تعريف JSON مرقّم؛ المنشور لقطة لا تتغير.
 *  3. `print_template_assignments`: أي مراجعة منشورة هي الافتراضية لنوع مستند
 *     واستعمال (طباعة/PDF) وللفرع أو المؤسسة.
 *
 * القالب نفسه CompanyWide؛ أما الفرع فقرار اختيار تشغيلي لا نسخة من القالب.
 * فلا تتكرر الهوية عند كل فرع، ويستطيع الفرع تجاوز التعيين العام فقط.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('print_templates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            // custom = أنشأه المستأجر، migrated = نسخة انتقالية من إعدادات قائمة.
            $table->string('source')->default('custom');
            $table->string('status')->default('draft'); // draft | published | archived
            $table->json('document_types');
            // لا FK دائري مع revisions: الخدمة وحدها تنشر مراجعة من هذا القالب.
            $table->uuid('published_revision_id')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'name']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('print_template_revisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('print_template_id')->constrained('print_templates')->cascadeOnDelete();
            // رقم تصاعدي داخل القالب؛ لا يسمح بنسختين تحملان رقم الإصدار نفسه.
            $table->unsignedInteger('version');
            $table->string('status')->default('draft'); // draft | published | superseded
            $table->unsignedSmallInteger('schema_version')->default(1);
            $table->json('document_types');
            $table->json('definition');
            // SHA-256 لتعريف Canonical JSON: دليل أن المراجعة المنشورة لم تتبدل.
            $table->char('checksum', 64);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('published_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'print_template_id', 'version']);
            $table->index(['tenant_id', 'print_template_id', 'status']);
        });

        Schema::create('print_template_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // null = افتراضي المؤسسة؛ قيمة = تجاوز لذلك الفرع فقط.
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('document_type');
            $table->string('usage')->default('print'); // print | pdf | thermal
            $table->foreignUuid('print_template_revision_id')
                ->constrained('print_template_revisions')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'document_type', 'usage']);
            $table->index(['tenant_id', 'document_type', 'usage']);
        });

        // NULL لا يساوي NULL: المفتاح المركب السابق لا يحمي افتراضي المؤسسة.
        // هذا الفهرس الجزئي مدعوم في SQLite وPostgreSQL ويمنع افتراضيين عامين.
        DB::statement(
            'CREATE UNIQUE INDEX print_template_assignments_company_default_unique '
            . 'ON print_template_assignments (tenant_id, document_type, usage) '
            . 'WHERE branch_id IS NULL'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX print_template_assignments_company_default_unique');
        Schema::dropIfExists('print_template_assignments');
        Schema::dropIfExists('print_template_revisions');
        Schema::dropIfExists('print_templates');
    }
};
