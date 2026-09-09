<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * لغة مستند الفاتورة — قرار مسودة + لقطة تجميد، مستقلة عن UI locale وعن التصميم.
 *
 * كلا العمودين nullable للتوافق الرجعي الكامل: كل صفوف الفواتير القائمة تحصل
 * على NULL؛ العرض يسقط تلقائياً إلى `tenants.settings.default_document_language`
 * ثم إلى `ar`. لا backfill ولا مساس بأعمدة أخرى.
 *
 * `language` = قرار المسودة (يُعدَّل حتى الترحيل).
 * `language_frozen` = لقطة العرض عند الترحيل (immutable بعد post).
 *
 * التجميد يحدث في `InvoiceService::post()` عبر نفس نقطة الالتزام التي تُجمِّد
 * لقطات القوالب — بلا خدمة جديدة ولا سيمنطيقس جديدة.
 *
 * إضافة عمود إلى `invoices` تعيد SQLite بناء الجدول فتفقد الفهرس الجزئي اليدوي
 * للصفوف بلا فرع؛ يُستعاد الشرط بعد up/down كما في الترحيلات السابقة على الجدول.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            // VARCHAR(16) — يحتمل مفردات V1 (`ar`,`en`,`bilingual`) وأي توسّع مستقبلي
            // مقيّد في `PrintTemplateContract::DOCUMENT_LANGUAGES`. الحارس في PHP.
            $table->string('language', 16)->nullable()
                ->after('pdf_template_override_revision_id');
            $table->string('language_frozen', 16)->nullable()
                ->after('language');
        });

        $this->restoreInvoiceBranchlessNumberIndex();
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn(['language_frozen', 'language']);
        });

        $this->restoreInvoiceBranchlessNumberIndex();
    }

    private function restoreInvoiceBranchlessNumberIndex(): void
    {
        DB::statement('DROP INDEX IF EXISTS invoices_tenant_id_number_branchless_unique');
        DB::statement(
            'CREATE UNIQUE INDEX invoices_tenant_id_number_branchless_unique '
            . 'ON invoices (tenant_id, number) WHERE branch_id IS NULL'
        );
    }
};
