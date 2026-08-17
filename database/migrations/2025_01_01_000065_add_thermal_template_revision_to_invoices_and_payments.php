<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * لقطة مراجعة الطباعة الحرارية مستقلة عن الطباعة القياسية وPDF. يقتصر هذا
 * الترحيل على الفاتورة والسند، وهما المستندان اللذان يعلن سجل الواجهة دعماً
 * حرارياً صريحاً اليوم. تبقى القيم الفارغة متوافقة مع السجلات القديمة.
 *
 * إعادة بناء SQLite لجدول الفواتير عند إضافة المفتاح الأجنبي قد تفقد شرط
 * الفهرس الجزئي للصفوف بلا فرع؛ لذلك يُعاد إنشاؤه في طريقي الترحيل والتراجع.
 */
return new class extends Migration
{
    private const TABLES = ['invoices', 'payments'];

    public function up(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('thermal_template_revision_id')->nullable()
                    ->after('pdf_template_revision_id')
                    ->constrained('print_template_revisions')->nullOnDelete();
            });
        }

        $this->restoreInvoiceBranchlessNumberIndex();
    }

    public function down(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('thermal_template_revision_id');
            });
        }

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
