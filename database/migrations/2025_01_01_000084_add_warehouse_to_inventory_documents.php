<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * تثبيت موقع الكمية على رأس المستند. الحقول nullable عمداً:
     * - المستندات التي سبقت المخازن تبقى قابلة للقراءة والترحيل التاريخي.
     * - لا يعيد هذا الترحيل تفسير حركة مخزون أو قيد صادر سابقاً.
     */
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->foreignUuid('warehouse_id')->nullable()->after('branch_id')
                ->constrained('warehouses')->nullOnDelete();
        });

        Schema::table('purchases', function (Blueprint $table) {
            $table->foreignUuid('warehouse_id')->nullable()->after('branch_id')
                ->constrained('warehouses')->nullOnDelete();
        });

        Schema::table('return_documents', function (Blueprint $table) {
            $table->foreignUuid('warehouse_id')->nullable()->after('branch_id')
                ->constrained('warehouses')->nullOnDelete();
        });

        // إضافة مفتاح أجنبي إلى invoices تعيد بناء الجدول في SQLite. هذا يعيد
        // الفهرس الجزئي اليدوي بلا شرط WHERE، فيتحول إلى تفرد مؤسسي ويكسر
        // تسلسل رقم الفاتورة المستقل لكل فرع. نعيد إنشاءه كحارسٍ للصفوف بلا فرع فقط.
        $this->restoreInvoiceBranchlessNumberIndex();
    }

    public function down(): void
    {
        Schema::table('return_documents', function (Blueprint $table) {
            $table->dropConstrainedForeignId('warehouse_id');
        });

        Schema::table('purchases', function (Blueprint $table) {
            $table->dropConstrainedForeignId('warehouse_id');
        });

        Schema::table('invoices', function (Blueprint $table) {
            $table->dropConstrainedForeignId('warehouse_id');
        });

        $this->restoreInvoiceBranchlessNumberIndex();
    }

    /** يعيد الحارس الجزئي بعد أي إعادة بناء SQLite لجدول invoices. */
    private function restoreInvoiceBranchlessNumberIndex(): void
    {
        DB::statement('DROP INDEX IF EXISTS invoices_tenant_id_number_branchless_unique');
        DB::statement(
            'CREATE UNIQUE INDEX invoices_tenant_id_number_branchless_unique '
            . 'ON invoices (tenant_id, number) WHERE branch_id IS NULL'
        );
    }
};
