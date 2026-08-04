<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // وضع احتساب الضريبة لعرض السعر: false = غير متضمّنة (تُضاف فوق السعر — الافتراضي)،
        // true = متضمّنة (تُستخرَج من السعر). لا يغيّر أي عرض قائم (افتراضي false).
        Schema::table('quotes', function (Blueprint $table) {
            $table->boolean('tax_inclusive')->default(false)->after('total');
        });
    }

    public function down(): void
    {
        Schema::table('quotes', function (Blueprint $table) {
            $table->dropColumn('tax_inclusive');
        });
    }
};
