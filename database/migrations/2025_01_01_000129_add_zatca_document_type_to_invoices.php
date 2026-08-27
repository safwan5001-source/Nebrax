<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            // لقطة قرار ZATCA: Standard/Clearance أو Simplified/Reporting.
            $table->string('zatca_document_type', 20)->nullable()->after('payment_type');
        });

        // كل XML تاريخي أنشأه المحرك السابق يحمل 0100000 صراحةً؛ نحفظ الحقيقة
        // نفسها بدل ترك API يخمّنها من بيانات عميل قد تكون تغيّرت لاحقاً.
        DB::table('invoices')
            ->whereNotNull('zatca_xml')
            ->whereNull('zatca_document_type')
            ->update(['zatca_document_type' => 'standard']);
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn('zatca_document_type');
        });
    }
};
