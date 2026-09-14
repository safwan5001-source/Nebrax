<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * VAR-PRICE-1 — هويّة التسعير الأساسي الموحّدة (Product/Variant × UOM).
 *
 * ═══════════════════════════════════════════════════════════════
 *  لماذا جدولٌ جديد لا امتدادٌ على `products`؟
 * ═══════════════════════════════════════════════════════════════
 *  السعر الأساسي الحقيقي اليوم عمودٌ واحد (`products.sale_price`) لوحدة
 *  الأساس فقط — لا سعر أساسي (لا قائمة أسعار) لأي وحدةٍ بديلة إطلاقاً، ولا
 *  عمود سعرٍ على `product_variants` أصلاً. هذا الجدول يوسّع النموذج تماماً
 *  كما وسّع `inventory_states` نموذج المخزون (VAR-INV-1) بنفس الشكل حرفياً:
 *
 *    منتجٌ بسيط        -> سعرٌ أساسي واحد لكل وحدة (product_variant_id = NULL)
 *    منتجٌ متعدد الخيارات -> الأب **يحتفظ** بسعره الأساسي (خلافاً للمخزون:
 *                          السعر مرجعٌ تراجعي صريح للمتغيّر — البند ٦ من
 *                          العقد) + كل متغيّرٍ فعلي قد يملك سعوره الصريحة
 *
 *  ═══ لماذا الأب يحتفظ بسعرٍ خلافاً لتصميم InventoryState؟ ═══
 *  المخزون: لا معنى لكمية «أب» لأن البيع الفعلي يخرج من متغيّرٍ بعينه.
 *  التسعير: العقد نفسه (البند ٦) يجعل سعر المنتج الأساسي **مرجعاً تراجعياً
 *  معتمَداً** لسعر متغيّرٍ بلا سعرٍ صريح لنفس الوحدة — فحذف هويّة الأب هنا
 *  كان سيكسر التراجع المطلوب صراحةً، لا يحميه.
 *
 *  ═══ الإنشاء ليس كسولاً هنا (خلافاً لـ InventoryState) ═══
 *  `sale_price` إلزاميٌّ عند إنشاء أي منتج (`StoreProductRequest`) — فصفّ
 *  السعر الأساسي للمنتج البسيط/الأب ينشأ فوراً مع كل منتج، لا عند أول حركة.
 *  لا تناقض هنا مع فلسفة الإنشاء الكسول في VAR-INV-1: هناك الوجود نفسه دليل
 *  أثرٍ حقيقي (`INVENTORY_SEMANTIC`)، وهنا التصنيف `COMMERCIAL_LIVE` أصلاً —
 *  تهيئةٌ حيّة لا تاريخاً، فوجودها من اللحظة الأولى هو السلوك الصحيح تماماً
 *  مثل `PriceListItem` نفسها.
 *
 *  ═══ قيدا التفرّد (يوازيان migration `create_inventory_states` حرفياً) ═══
 *  • هويّة منتج: `(product_id, unit_name)` حيث `product_variant_id IS NULL`.
 *  • هويّة متغيّر: `(product_variant_id, unit_name)` — لا فهرسٍ جزئي هنا
 *    (NULL لا يساوي NULL في SQL فلا يقيّد صفوف المنتجات البسيطة إطلاقاً).
 *
 *  كلاهما `CREATE UNIQUE INDEX` مباشرة على **جدولٍ جديد بالكامل** — لا خطر
 *  إعادة بناء SQLite المعروف.
 *
 *  ═══ `price_list_items` — إضافة عمود، لا إعادة بناء ═══
 *  عمود `product_variant_id` اختياري يُضاف بـ`ALTER TABLE ADD COLUMN` فقط،
 *  ثم يُستبدل القيد الفريد القديم `(price_list_id, product_id, unit_name)`
 *  بفهرسين جزئيين يوازيان أعلاه — لا CHECK constraint على هذا الجدول اليوم
 *  (مؤكَّد من الترحيلات القائمة)، فلا خطر فقدانه من رحلة SQLite `Schema::table`.
 *
 *  ═══ الترحيل/الزرع الاستدلالي ═══
 *  بيانات ما قبل الإنتاج (تجريبية/اختبارية) — يُسمح بإعادة بناءٍ حتمية
 *  (البند ٢٦). لكل منتجٍ قائم: يُنشأ سعرٌ أساسي واحد بوحدته الحالية
 *  (`products.unit`) بقيمة `products.sale_price` الحالية — تحويلٌ حتميٌّ
 *  من مصدرٍ حقيقي، لا تخمين. **لا** يُخترع سعرٌ لأي وحدةٍ بديلة، **لا** يُخترع
 *  سعرٌ لأي متغيّر، **لا** ضربٌ بمعامل تحويل.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_unit_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('product_variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->string('unit_name', 255);
            $table->unsignedBigInteger('price');
            $table->timestamps();

            $table->index(['tenant_id', 'product_id']);
        });

        DB::statement(
            'CREATE UNIQUE INDEX product_unit_prices_simple_unique ON product_unit_prices (product_id, unit_name) WHERE product_variant_id IS NULL'
        );
        DB::statement(
            'CREATE UNIQUE INDEX product_unit_prices_variant_unique ON product_unit_prices (product_variant_id, unit_name) WHERE product_variant_id IS NOT NULL'
        );

        // زرعٌ استدلاليّ حتميّ: سعرٌ أساسي واحد لكل منتجٍ قائم بوحدته الحالية.
        $now = now();
        DB::table('products')->orderBy('id')->select(['id', 'tenant_id', 'unit', 'sale_price'])
            ->chunkById(500, function ($products) use ($now) {
                $rows = [];
                foreach ($products as $product) {
                    $rows[] = [
                        'id' => (string) Str::uuid(),
                        'tenant_id' => $product->tenant_id,
                        'product_id' => $product->id,
                        'product_variant_id' => null,
                        'unit_name' => $product->unit,
                        'price' => (int) $product->sale_price,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }
                if ($rows !== []) {
                    DB::table('product_unit_prices')->insert($rows);
                }
            });

        Schema::table('price_list_items', function (Blueprint $table) {
            $table->foreignUuid('product_variant_id')->nullable()->after('product_id')
                ->constrained('product_variants')->cascadeOnDelete();
        });

        Schema::table('price_list_items', function (Blueprint $table) {
            $table->dropUnique('price_list_items_price_list_id_product_id_unit_name_unique');
        });

        DB::statement(
            'CREATE UNIQUE INDEX price_list_items_simple_unique ON price_list_items (price_list_id, product_id, unit_name) WHERE product_variant_id IS NULL'
        );
        DB::statement(
            'CREATE UNIQUE INDEX price_list_items_variant_unique ON price_list_items (price_list_id, product_variant_id, unit_name) WHERE product_variant_id IS NOT NULL'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX price_list_items_variant_unique');
        DB::statement('DROP INDEX price_list_items_simple_unique');

        Schema::table('price_list_items', function (Blueprint $table) {
            $table->unique(['price_list_id', 'product_id', 'unit_name']);
        });

        Schema::table('price_list_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('product_variant_id');
        });

        Schema::dropIfExists('product_unit_prices');
    }
};
