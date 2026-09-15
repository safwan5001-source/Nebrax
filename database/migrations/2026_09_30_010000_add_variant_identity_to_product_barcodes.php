<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-POS-1 — أصغر امتدادٍ إضافي يمثّل «باركود متغيّرٍ فعلي». `product_barcodes`
 * (الباركود البديل متعدد الوحدات، PR-UOM-1) يحمل `product_id`/`unit_name` فقط؛
 * لا عمود يربط باركوداً بمتغيّرٍ بعينه. الباركود يبقى **محلّاً (resolver) لا
 * سلطة سعرٍ** (العقد الموثّق: docs/plans/products-inventory/
 * AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md) — هذا العمود يضيف
 * هويّة المتغيّر التي يحلّها الباركود فقط، لا سعراً مخزَّناً بجانبه.
 *
 * `nullOnDelete()` يطابق نمط `product_id` على الجدول نفسه — شبكة أمان قاعدة
 * بيانات لا حارساً فعلياً؛ الحارس الفعلي `PosBarcodeResolver`/`ProductBarcode::booted()` أدناه.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_barcodes', function (Blueprint $table) {
            $table->uuid('product_variant_id')->nullable()->after('product_id');
            $table->foreign('product_variant_id')->references('id')->on('product_variants')->nullOnDelete();
            $table->index('product_variant_id');
        });
    }

    public function down(): void
    {
        Schema::table('product_barcodes', function (Blueprint $table) {
            $table->dropForeign(['product_variant_id']);
            $table->dropIndex(['product_variant_id']);
            $table->dropColumn('product_variant_id');
        });
    }
};
