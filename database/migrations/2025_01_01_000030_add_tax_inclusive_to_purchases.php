<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // وضع احتساب الضريبة لفاتورة المشتريات: false = التكلفة غير متضمّنة الضريبة
        // (تُضاف فوقها — الافتراضي)، true = متضمّنة (تُستخرَج، فيُقيَّم المخزون بالصافي).
        // لا يغيّر أي فاتورة قائمة (افتراضي false).
        Schema::table('purchases', function (Blueprint $table) {
            $table->boolean('tax_inclusive')->default(false)->after('total');
        });
    }

    public function down(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            $table->dropColumn('tax_inclusive');
        });
    }
};
