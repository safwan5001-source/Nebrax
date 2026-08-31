<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            // تحفظ نسخة Clearance الرسمية منفصلة؛ zatca_xml يبقى لقطة الإرسال
            // التي بُنيت عليها invoiceHash وسلسلة PIH.
            $table->longText('zatca_cleared_xml')->nullable()->after('zatca_xml');
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn('zatca_cleared_xml');
        });
    }
};
