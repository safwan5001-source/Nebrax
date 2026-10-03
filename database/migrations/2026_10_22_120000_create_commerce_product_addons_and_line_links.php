<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H6 / ADR-18 — إضافات مدعومة بمنتجات حقيقية: علاقة صريحة أب⇒إضافة، وروابط
 * أب/ابن على سطر السلة وسطر الطلب (أعمدة اختيارية إضافية؛ الصفوف القائمة تبقى NULL).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_product_addons', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('addon_product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('addon_variant_id')->nullable()->constrained('product_variants')->nullOnDelete();
            $table->unsignedSmallInteger('max_quantity')->default(1);
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['product_id', 'addon_product_id']);
            $table->index(['tenant_id', 'product_id', 'is_active', 'sort_order'], 'cpa_product_active_sort');
        });

        Schema::table('commerce_cart_items', function (Blueprint $table) {
            $table->foreignUuid('parent_item_id')->nullable()->constrained('commerce_cart_items')->cascadeOnDelete();
            $table->unsignedSmallInteger('per_parent_quantity')->nullable();
            $table->index('parent_item_id');
        });

        // SQLite لا يضيف مفتاحاً أجنبياً بـALTER: يعيد Laravel بناء الجدول من مخطّطه المُستبطَن، والفهارس
        // الجزئية (WHERE) تُفقَد شرطها فتصير فريدةً كاملة — فيُمنَع سطرا متغيّرَين لمنتجٍ واحد. نعيد
        // إنشاءها حرفياً كما عرّفتها migration التخصيص. PostgreSQL لا يعيد بناءً فلا يحتاج.
        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::statement('DROP INDEX IF EXISTS commerce_cart_items_variant_identity_unique');
            DB::statement('DROP INDEX IF EXISTS commerce_cart_items_simple_identity_unique');
            DB::statement(
                'CREATE UNIQUE INDEX commerce_cart_items_simple_identity_unique ON commerce_cart_items (cart_id, product_id, unit_key, personalization_signature) WHERE product_variant_id IS NULL'
            );
            DB::statement(
                'CREATE UNIQUE INDEX commerce_cart_items_variant_identity_unique ON commerce_cart_items (cart_id, product_id, product_variant_id, unit_key, personalization_signature) WHERE product_variant_id IS NOT NULL'
            );
        }

        Schema::table('commerce_order_lines', function (Blueprint $table) {
            $table->foreignUuid('parent_line_id')->nullable()->constrained('commerce_order_lines')->cascadeOnDelete();
            $table->index('parent_line_id');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_order_lines', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_line_id');
        });
        Schema::table('commerce_cart_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_item_id');
            $table->dropColumn('per_parent_quantity');
        });
        Schema::dropIfExists('commerce_product_addons');
    }
};
