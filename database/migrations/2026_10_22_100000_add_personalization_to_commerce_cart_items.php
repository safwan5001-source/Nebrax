<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H4b / ADR-16 — هوية التخصيص في سطر السلة + قيم السلة + لقطة سطر الطلب.
 *
 * `personalization_signature` (`NOT NULL DEFAULT ''`): بصمة المُدخَل المطبَّع؛ تدخل في
 * هوية السطر عبر إعادة بناء الفهرسين الجزئيين، فيندمج المنتج نفسه بالمُدخَل نفسه
 * ويتفرّع بمُدخَلٍ مختلف. الصفوف القائمة تأخذ `''` فلا يتغيّر سلوكها.
 *
 * القيم بلا مفتاح أجنبي نحو التعريف (مرجع ناعم بالمفتاح + لقطة تسمية) كي لا يكسر
 * تعديل التعريف سلةً أو طلباً. لقطة السطر تُنسخ داخل معاملة الإتمام وتتجمّد بعد التأكيد.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_cart_items', function (Blueprint $table) {
            $table->string('personalization_signature', 64)->default('')->after('unit_key');
        });

        DB::statement('DROP INDEX commerce_cart_items_variant_identity_unique');
        DB::statement('DROP INDEX commerce_cart_items_simple_identity_unique');
        DB::statement(
            'CREATE UNIQUE INDEX commerce_cart_items_simple_identity_unique ON commerce_cart_items (cart_id, product_id, unit_key, personalization_signature) WHERE product_variant_id IS NULL'
        );
        DB::statement(
            'CREATE UNIQUE INDEX commerce_cart_items_variant_identity_unique ON commerce_cart_items (cart_id, product_id, product_variant_id, unit_key, personalization_signature) WHERE product_variant_id IS NOT NULL'
        );

        Schema::create('commerce_cart_item_personalizations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('cart_item_id')->constrained('commerce_cart_items')->cascadeOnDelete();
            $table->string('field_key', 48);
            $table->string('field_type', 16);
            $table->string('label', 120);
            $table->string('label_en', 120)->nullable();
            $table->text('value');
            $table->string('value_label', 120)->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['cart_item_id', 'field_key']);
            $table->index('tenant_id');
        });

        Schema::create('commerce_order_line_personalizations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_line_id')->constrained('commerce_order_lines')->cascadeOnDelete();
            $table->string('field_key', 48);
            $table->string('field_type', 16);
            $table->string('label', 120);
            $table->string('label_en', 120)->nullable();
            $table->text('value');
            $table->string('value_label', 120)->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['commerce_order_line_id', 'field_key'], 'colp_line_key_unique');
            $table->index('tenant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_order_line_personalizations');
        Schema::dropIfExists('commerce_cart_item_personalizations');

        DB::statement('DROP INDEX commerce_cart_items_variant_identity_unique');
        DB::statement('DROP INDEX commerce_cart_items_simple_identity_unique');
        DB::statement(
            'CREATE UNIQUE INDEX commerce_cart_items_simple_identity_unique ON commerce_cart_items (cart_id, product_id, unit_key) WHERE product_variant_id IS NULL'
        );
        DB::statement(
            'CREATE UNIQUE INDEX commerce_cart_items_variant_identity_unique ON commerce_cart_items (cart_id, product_id, product_variant_id, unit_key) WHERE product_variant_id IS NOT NULL'
        );

        Schema::table('commerce_cart_items', function (Blueprint $table) {
            $table->dropColumn('personalization_signature');
        });
    }
};
