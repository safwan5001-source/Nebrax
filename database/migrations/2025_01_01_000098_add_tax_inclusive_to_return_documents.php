<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // الافتراض false يفسر كل مرتجع قائم بسلوكه التاريخي. مرتجع POS الجديد
        // يثبت لقطة وضع ضريبة الفاتورة المصدر كي لا يخلط السعر المتضمن بالصافي.
        Schema::table('return_documents', function (Blueprint $table) {
            $table->boolean('tax_inclusive')->default(false)->after('payment_type');
        });
    }

    public function down(): void
    {
        Schema::table('return_documents', function (Blueprint $table) {
            $table->dropColumn('tax_inclusive');
        });
    }
};
