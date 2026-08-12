<?php

namespace Tests\Feature;

use App\Models\Brand;
use App\Models\Product;
use App\Models\ProductCategory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تصنيفات المنتجات والعلامات التجارية — قائمة مُدارة بدل نصّ حرّ
 * ═══════════════════════════════════════════════════════════════
 *  كيانان بلا أثر محاسبي: لا حساب يرتبط بهما ولا قيد يُولَّد منهما. فمحور
 *  الاختبار هنا **سلامة البيانات** لا التوازن: الشجرة بلا دورات، والاسم فريد
 *  بين الإخوة، والحذف لا يُيتّم منتجاً صامتاً، والترقية لا تُفقد أحداً تصنيفاته.
 *
 *  تشغيل: php artisan test --filter=ProductClassificationTest
 */
class ProductClassificationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        $this->token = $this->registerTenant()['token'];
    }

    private function category(string $name, ?string $parentId = null): array
    {
        return $this->withToken($this->token)->postJson('/api/product-categories', [
            'name' => $name, 'parent_id' => $parentId,
        ])->assertCreated()['data'];
    }

    private function brand(string $name): array
    {
        return $this->withToken($this->token)
            ->postJson('/api/brands', ['name' => $name])->assertCreated()['data'];
    }

    private function product(array $overrides = []): array
    {
        return $this->withToken($this->token)->postJson('/api/products', array_merge([
            'name' => 'صنف', 'sku' => 'S-' . uniqid(), 'type' => 'good', 'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    /** الشجرة تُبنى بالمستويات، والقائمة تُعيدها مسطّحة بـ `parent_id`. */
    /** @test */
    public function categories_form_a_multi_level_tree(): void
    {
        $root  = $this->category('قطع غيار');
        $child = $this->category('فلاتر', $root['id']);

        $this->assertNull($root['parent_id']);
        $this->assertSame($root['id'], $child['parent_id']);

        $list = $this->withToken($this->token)->getJson('/api/product-categories')->assertOk()['data'];
        $this->assertCount(2, $list);
    }

    /**
     * **الاسم فريد بين الإخوة لا في الشجرة كلّها.** «فلاتر» تحت «زيوت» وأخرى
     * تحت «قطع غيار» تسميةٌ سليمة؛ منعُها تضييقٌ بلا سبب.
     *
     * @test
     */
    public function a_name_is_unique_among_siblings_only(): void
    {
        $a = $this->category('قطع غيار');
        $b = $this->category('زيوت');

        $this->category('فلاتر', $a['id']);
        $this->category('فلاتر', $b['id']); // أخٌ لغيره — يمرّ

        $this->withToken($this->token)
            ->postJson('/api/product-categories', ['name' => 'فلاتر', 'parent_id' => $a['id']])
            ->assertStatus(422);
    }

    /**
     * والجذور تخضع للقاعدة نفسها — وهي الحالة التي **لا يمسكها قيدٌ فريد** في
     * قاعدة البيانات: `NULL` لا يساوي `NULL` في الفهرس الفريد، فيمرّ جذران
     * بالاسم نفسه. لذلك الفحص في المتحكّم.
     *
     * @test
     */
    public function two_root_categories_cannot_share_a_name(): void
    {
        $this->category('قطع غيار');

        $this->withToken($this->token)
            ->postJson('/api/product-categories', ['name' => 'قطع غيار'])
            ->assertStatus(422);
    }

    /** **الدورة تُرفض:** تصنيف أباً لنفسه أو لأحد فروعه شجرةٌ بلا قاع. */
    /** @test */
    public function a_category_cannot_become_its_own_descendant(): void
    {
        $root  = $this->category('قطع غيار');
        $child = $this->category('فلاتر', $root['id']);

        // أباً لنفسه
        $this->withToken($this->token)
            ->putJson("/api/product-categories/{$root['id']}", ['name' => 'قطع غيار', 'parent_id' => $root['id']])
            ->assertStatus(422);

        // أباً لابنه (دورة غير مباشرة)
        $this->withToken($this->token)
            ->putJson("/api/product-categories/{$root['id']}", ['name' => 'قطع غيار', 'parent_id' => $child['id']])
            ->assertStatus(422);

        $this->assertNull(ProductCategory::findOrFail($root['id'])->parent_id);
    }

    /** الأب من مستأجر آخر لا يُقبل — العزل قبل كل شيء. */
    /** @test */
    public function a_parent_from_another_tenant_is_rejected(): void
    {
        $other  = $this->registerTenant('other', 'other@nibras.test');
        $theirs = $this->withToken($other['token'])
            ->postJson('/api/product-categories', ['name' => 'تصنيفهم'])->assertCreated()['data'];

        $this->withToken($this->token)
            ->postJson('/api/product-categories', ['name' => 'تصنيفي', 'parent_id' => $theirs['id']])
            ->assertStatus(422);
    }

    /** المنتج يُربط بالتصنيف والعلامة، والمورد يُعيد الاسم من العلاقة. */
    /** @test */
    public function a_product_links_to_a_category_and_a_brand(): void
    {
        $category = $this->category('قطع غيار');
        $brand    = $this->brand('بوش');

        $product = $this->product(['category_id' => $category['id'], 'brand_id' => $brand['id']]);

        $this->assertSame($category['id'], $product['category_id']);
        $this->assertSame('قطع غيار', $product['category']);
        $this->assertSame('بوش', $product['brand']);
    }

    /**
     * **مكسب إعادة التسمية.** الاسم يُقرأ من العلاقة لا من نسخة محفوظة، فتغيير
     * التصنيف يسري على كل منتجاته فوراً بلا مزامنة ولا وظيفة خلفية.
     *
     * @test
     */
    public function renaming_a_category_flows_to_its_products_at_once(): void
    {
        $category = $this->category('قطع غيار');
        $product  = $this->product(['category_id' => $category['id']]);

        $this->withToken($this->token)
            ->putJson("/api/product-categories/{$category['id']}", ['name' => 'قطع الغيار'])
            ->assertOk();

        $this->assertSame(
            'قطع الغيار',
            $this->withToken($this->token)->getJson("/api/products/{$product['id']}")['data']['category']
        );
    }

    /**
     * **الحذف لا يُيتّم منتجاً صامتاً.** الحذف ناعم فلا يُطلق المفتاح الأجنبي
     * ولا تُصفَّر `category_id`؛ لو مرّ لاختفى التصنيف من الشاشة بلا سبب مفهوم.
     *
     * @test
     */
    public function a_category_in_use_cannot_be_deleted(): void
    {
        $category = $this->category('قطع غيار');
        $this->product(['category_id' => $category['id']]);

        $this->withToken($this->token)
            ->deleteJson("/api/product-categories/{$category['id']}")
            ->assertStatus(422);

        $this->assertNotNull(ProductCategory::find($category['id']));
    }

    /** ولا يُحذف تصنيف له فروع — الفروع كانت ستبقى بأبٍ محذوف. */
    /** @test */
    public function a_category_with_children_cannot_be_deleted(): void
    {
        $root = $this->category('قطع غيار');
        $this->category('فلاتر', $root['id']);

        $this->withToken($this->token)
            ->deleteJson("/api/product-categories/{$root['id']}")
            ->assertStatus(422);
    }

    /** والفارغ يُحذف. */
    /** @test */
    public function an_unused_category_is_deleted(): void
    {
        $category = $this->category('مؤقّت');

        $this->withToken($this->token)
            ->deleteJson("/api/product-categories/{$category['id']}")->assertOk();

        $this->assertNull(ProductCategory::find($category['id']));
    }

    /** العلامة التجارية قائمة مسطّحة باسم فريد. */
    /** @test */
    public function brand_names_are_unique(): void
    {
        $this->brand('بوش');

        $this->withToken($this->token)->postJson('/api/brands', ['name' => 'بوش'])->assertStatus(422);
    }

    /** والعلامة المستعمَلة لا تُحذف. */
    /** @test */
    public function a_brand_in_use_cannot_be_deleted(): void
    {
        $brand = $this->brand('بوش');
        $this->product(['brand_id' => $brand['id']]);

        $this->withToken($this->token)->deleteJson("/api/brands/{$brand['id']}")->assertStatus(422);
    }

    /** القائمة تحمل عدّ المنتجات — ليقرّر المستخدم قبل الحذف لا بعد الرفض. */
    /** @test */
    public function the_list_carries_the_product_count(): void
    {
        $category = $this->category('قطع غيار');
        $this->product(['category_id' => $category['id']]);
        $this->product(['category_id' => $category['id']]);

        $row = $this->withToken($this->token)->getJson('/api/product-categories')->assertOk()['data'][0];
        $this->assertSame(2, $row['products_count']);
    }

    /** العزل: قائمة مستأجر لا تظهر لآخر. */
    /** @test */
    public function lists_are_isolated_per_tenant(): void
    {
        $this->category('قطع غيار');
        $this->brand('بوش');

        $other = $this->registerTenant('other', 'other@nibras.test');

        $this->assertCount(0, $this->withToken($other['token'])->getJson('/api/product-categories')['data']);
        $this->assertCount(0, $this->withToken($other['token'])->getJson('/api/brands')['data']);
    }

    /**
     * **الترقية لا تُفقد أحداً تصنيفاته.** هجرة 000045 تبني القائمة من النصّ
     * الحرّ القائم وتربط منتجاته — فمن فتح الشاشة بعد الترقية وجد تصنيفاته
     * كما كتبها، لا قائمة فارغة يعيد ملأها بيده.
     *
     * @test
     */
    public function the_migration_builds_the_lists_from_existing_free_text(): void
    {
        // منتجات «ما قبل الترقية»: نصّ حرّ بلا معرّف.
        $legacy = $this->product(['name' => 'فلتر زيت', 'category' => 'قطع غيار', 'brand' => 'بوش']);
        $this->product(['name' => 'فلتر هواء', 'category' => 'قطع غيار', 'brand' => 'بوش']);

        DB::table('products')->update(['category_id' => null, 'brand_id' => null]);
        ProductCategory::query()->forceDelete();
        Brand::query()->forceDelete();

        (require database_path('migrations/2025_01_01_000045_create_product_categories_and_brands.php'))
            ->backfillAll();

        $this->assertSame(1, ProductCategory::count(), 'الاسم المكرَّر لا يُنشئ صفّين.');
        $this->assertSame('قطع غيار', ProductCategory::first()->name);

        $product = Product::findOrFail($legacy['id']);
        $this->assertSame(ProductCategory::first()->id, $product->category_id);
        $this->assertSame(Brand::first()->id, $product->brand_id);
    }
}
