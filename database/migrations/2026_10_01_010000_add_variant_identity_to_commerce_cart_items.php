<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-COM-1 — هوية المتغيّر في سطر سلة Commerce.
 *
 * نفس نمط `2026_09_30_010000_add_variant_identity_to_product_barcodes`
 * حرفياً: عمودٌ اختياري + استبدال القيد الفريد القديم `(cart_id, product_id,
 * unit_key)` بفهرسين جزئيين — بلا متغيّر يبقى القيد كما كان تماماً لمنتجٍ
 * بسيط، ومع متغيّر يضيف بُعده لهويّة السطر فلا يندمج سطرا متغيّرين شقيقين
 * لنفس المنتج/الوحدة في سطرٍ واحد خطأً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_cart_items', function (Blueprint $table) {
            $table->foreignUuid('product_variant_id')->nullable()->after('product_id')
                ->constrained('product_variants')->nullOnDelete();
        });

        Schema::table('commerce_cart_items', function (Blueprint $table) {
            $table->dropUnique('commerce_cart_items_identity_unique');
        });

        DB::statement(
            'CREATE UNIQUE INDEX commerce_cart_items_simple_identity_unique ON commerce_cart_items (cart_id, product_id, unit_key) WHERE product_variant_id IS NULL'
        );
        DB::statement(
            'CREATE UNIQUE INDEX commerce_cart_items_variant_identity_unique ON commerce_cart_items (cart_id, product_id, product_variant_id, unit_key) WHERE product_variant_id IS NOT NULL'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX commerce_cart_items_variant_identity_unique');
        DB::statement('DROP INDEX commerce_cart_items_simple_identity_unique');

        Schema::table('commerce_cart_items', function (Blueprint $table) {
            $table->unique(['cart_id', 'product_id', 'unit_key'], 'commerce_cart_items_identity_unique');
        });

        Schema::table('commerce_cart_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('product_variant_id');
        });
    }
};
