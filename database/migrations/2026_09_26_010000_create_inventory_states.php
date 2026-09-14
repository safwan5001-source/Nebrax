<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-INV-1 — هوية المخزون والتقييم الموحّدة (Inventory State).
 *
 * ═══════════════════════════════════════════════════════════════
 *  لماذا جدولٌ جديد لا امتدادٌ على `products`؟
 * ═══════════════════════════════════════════════════════════════
 *  منتجٌ بسيط له هويّة مخزون واحدة؛ منتجٌ `variant_managed` له هويّة واحدة
 *  **لكل متغيّر فعلي**، والأب نفسه ليس هويّة مخزونٍ موازية (VAR_ARCH_1 §3).
 *  عمودا `products.quantity_on_hand`/`avg_cost` لا يسعان هذا الشكل: لا يوجد
 *  عمودٌ مكافئ على `product_variants` اليوم، وإضافته يُنتج حقيقتين قابلتين
 *  للتضارب (أب ومتغيّر معاً). جدولٌ واحدٌ بعمود `product_variant_id` اختياري
 *  يمثّل الحالتين بقيدٍ واحدٍ في قاعدة البيانات، لا فرعين من المنطق.
 *
 *  **الإنشاء كسول لا فوري** (يوازي `product_warehouse_stock` عبر
 *  `firstOrCreate` في `InventoryService::adjustWarehouseStock()` تماماً):
 *  الصفّ يُنشأ عند أول عملية تمسّ مخزون الهويّة فعلياً، لا عند إنشاء المنتج/
 *  المتغيّر. هذا يحفظ دلالة `ProductReferenceRegistry::INVENTORY_SEMANTIC`
 *  سليمة — وجود الصفّ نفسه دليل أثرٍ مخزنيّ حقيقي، تماماً مثل `StockMovement`
 *  و`ProductWarehouseStock` المصنَّفين بالفئة نفسها؛ لو أُنشئ الصفّ فوراً لكل
 *  منتج (كميته صفر) لصار حارس `hasInventoryFootprint()` يمنع تغيير `type`/
 *  `track_inventory` على **كل** منتج للأبد — تناقضٌ لا يحتاج قرار سياسة، بل
 *  تصميماً صحيحاً من البداية.
 *
 *  ═══ قيدا التفرّد ═══
 *  • هويّة بسيطة: `(product_id)` حيث `product_variant_id IS NULL` — فهرسٌ
 *    جزئي، فلا يمنع تعدّد صفوف المتغيّرات لنفس المنتج.
 *  • هويّة متغيّر: `unique(product_variant_id)` عادي — NULL لا يساوي NULL في
 *    SQL فلا يقيّد صفوف الهويّات البسيطة إطلاقاً؛ يمنع فقط تكرار متغيّرٍ واحد.
 *
 *  كلا الفهرسين على **جدولٍ جديد** بالكامل (`CREATE UNIQUE INDEX` مباشرة، لا
 *  `Schema::table` على جدولٍ قائم) — لا خطر إعادة بناء SQLite المعروف.
 *
 *  ═══ `product_warehouse_stock` — إضافة عمود، لا إعادة بناء ═══
 *  عمود `product_variant_id` اختياري يُضاف بـ `ALTER TABLE ADD COLUMN` فقط
 *  (SQLite يدعمها أصلاً بلا إعادة بناء الجدول)، ثم يُستبدل القيد الفريد
 *  القديم `(product_id, warehouse_id)` بفهرسين جزئيين يوازيان أعلاه تماماً —
 *  لا CHECK constraint على هذا الجدول اليوم (مؤكَّد من الترحيلات القائمة)،
 *  فلا خطر فقدانه من رحلة SQLite `Schema::table`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_states', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('product_variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->integer('quantity_on_hand')->default(0);
            $table->bigInteger('avg_cost')->default(0);
            $table->timestamps();

            $table->unique('product_variant_id');
            $table->index(['tenant_id', 'product_id']);
        });

        DB::statement(
            'CREATE UNIQUE INDEX inventory_states_simple_product_unique ON inventory_states (product_id) WHERE product_variant_id IS NULL'
        );

        Schema::table('product_warehouse_stock', function (Blueprint $table) {
            $table->foreignUuid('product_variant_id')->nullable()->after('product_id')
                ->constrained('product_variants')->nullOnDelete();
        });

        Schema::table('product_warehouse_stock', function (Blueprint $table) {
            $table->dropUnique('product_warehouse_stock_product_id_warehouse_id_unique');
        });

        DB::statement(
            'CREATE UNIQUE INDEX product_warehouse_stock_simple_unique ON product_warehouse_stock (product_id, warehouse_id) WHERE product_variant_id IS NULL'
        );
        DB::statement(
            'CREATE UNIQUE INDEX product_warehouse_stock_variant_unique ON product_warehouse_stock (product_variant_id, warehouse_id) WHERE product_variant_id IS NOT NULL'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX product_warehouse_stock_variant_unique');
        DB::statement('DROP INDEX product_warehouse_stock_simple_unique');

        Schema::table('product_warehouse_stock', function (Blueprint $table) {
            $table->unique(['product_id', 'warehouse_id']);
        });

        Schema::table('product_warehouse_stock', function (Blueprint $table) {
            $table->dropConstrainedForeignId('product_variant_id');
        });

        Schema::dropIfExists('inventory_states');
    }
};
