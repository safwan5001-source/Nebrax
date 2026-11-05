<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * #2011 — أعمدة إضافية فقط على سجل أسعار الوقود (لا تعديل لأي صف ولا لقيمة سعر):
 *  - idempotency_key: مفتاح إعادة المحاولة (ضغطتان/انقطاع) فلا يتكرر سجل السعر.
 *  - entry_source: كيف دخل السعر (manual | product_card)، للتدقيق وللعرض. الصفوف القائمة = manual.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_station_product_prices', function (Blueprint $table) {
            $table->string('idempotency_key', 64)->nullable();
            $table->string('entry_source', 32)->default('manual');
            $table->unique(['tenant_id', 'idempotency_key'], 'fuel_price_idempotency_unique');
        });
    }

    public function down(): void
    {
        Schema::table('fuel_station_product_prices', function (Blueprint $table) {
            $table->dropUnique('fuel_price_idempotency_unique');
            $table->dropColumn(['idempotency_key', 'entry_source']);
        });
    }
};
