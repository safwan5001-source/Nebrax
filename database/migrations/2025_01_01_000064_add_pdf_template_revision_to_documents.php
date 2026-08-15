<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * لقطة مراجعة PDF عند الترحيل مستقلة عن لقطة المعاينة/الطباعة. تبقى null
 * للمسوّدات والمستندات القديمة؛ يستعمل مسار الإخراج عندها لقطة الطباعة إن وجدت
 * ثم مسار التوافق السابق، فلا يعاد تفسير مستند تاريخي من تعيين PDF حي.
 *
 * إضافة مفتاح أجنبي إلى `invoices` تعيد SQLite بناء الجدول؛ فيفقد الفهرس
 * الجزئي اليدوي `invoices_tenant_id_number_branchless_unique` شرطه ويصير
 * قيداً مؤسسياً شاملاً. لذلك تستعيد هذه الهجرة شرط الصفوف بلا فرع بعد `up`
 * و`down`، فلا يتصادم تسلسل فرعين مستقلين.
 */
return new class extends Migration
{
    private const TABLES = ['invoices', 'credit_notes', 'payments', 'purchases'];

    public function up(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('pdf_template_revision_id')->nullable()
                    ->after('print_template_revision_id')
                    ->constrained('print_template_revisions')->nullOnDelete();
            });
        }

        $this->restoreInvoiceBranchlessNumberIndex();
    }

    public function down(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('pdf_template_revision_id');
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
