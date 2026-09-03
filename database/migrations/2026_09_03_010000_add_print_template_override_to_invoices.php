<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * اختيار تصميم المسودة مستقل عن لقطة التجميد عند الترحيل.
 *
 * العمودان nullable: المسودة بلا اختيار تتبع التعيين الحي كما كان. لا backfill
 * ولا مساس بأعمدة freeze. إضافة مفتاح أجنبي إلى `invoices` تعيد SQLite بناء
 * الجدول فتفقد الفهرس الجزئي اليدوي؛ يُستعاد شرط الصفوف بلا فرع بعد up/down.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->foreignUuid('print_template_override_revision_id')->nullable()
                ->after('thermal_template_revision_id')
                ->constrained('print_template_revisions')->nullOnDelete();
            $table->foreignUuid('pdf_template_override_revision_id')->nullable()
                ->after('print_template_override_revision_id')
                ->constrained('print_template_revisions')->nullOnDelete();
        });

        $this->restoreInvoiceBranchlessNumberIndex();
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropConstrainedForeignId('pdf_template_override_revision_id');
            $table->dropConstrainedForeignId('print_template_override_revision_id');
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
