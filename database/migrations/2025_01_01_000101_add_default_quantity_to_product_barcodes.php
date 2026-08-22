<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_barcodes', function (Blueprint $table) {
            // كمية إدخال السلة عند مسح هذا الرمز؛ ليست كمية مخزنية مستقلة ولا
            // تغير لقطة سطر فاتورة تاريخي. يبدأ كل باركود قائم بواحد.
            $table->unsignedInteger('default_quantity')->default(1)->after('unit_name');
        });
    }

    public function down(): void
    {
        Schema::table('product_barcodes', function (Blueprint $table) {
            $table->dropColumn('default_quantity');
        });
    }
};
