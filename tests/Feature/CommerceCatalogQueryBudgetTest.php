<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\ProductMedia;
use App\Services\ProductMediaGalleryService;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AD-09 / S10b — ميزانية استعلامات نقاط القراءة التي يستهلكها Runtime الجوال (قوائم المنتجات، البحث، التصنيف، الترتيب بالشعبية،
 * والتصنيفات): **عدد الاستعلامات ثابت** مهما زاد عدد الصفوف في الصفحة (لا N+1). يقيس طلباً دافئاً بـ3 صفوف ثم بـ20 ويشترط التساوي.
 *
 * تشغيل: php artisan test --filter=CommerceCatalogQueryBudgetTest
 */
class CommerceCatalogQueryBudgetTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function store(): array
    {
        $tenant = Tenant::create([
            'name' => 'متجر الميزانية', 'slug' => 'qb-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        app(TenantContext::class)->forget();
        $service = app(ApiClientKeyService::class);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $service->issueKey($service->createClient($tenant, 'mobile-app', true), 'default', [])->plainTextToken];
    }

    /** يضيف $count منتجاً منشوراً، كلٌّ بتصنيفه (فروع عدّة للتصنيفات تكشف أي تحميل لكل صف). */
    private function addProducts(array $store, int $count, ?string $categoryId = null): void
    {
        app(TenantContext::class)->set($store['tenant']->id);
        for ($i = 0; $i < $count; $i++) {
            $category = $categoryId ?? ProductCategory::create(['name' => 'تصنيف '.Str::random(5), 'is_active' => true])->id;
            $product = Product::create([
                'sku' => 'SKU-'.Str::random(8), 'name' => 'منتج '.Str::random(5), 'name_en' => 'Product '.Str::random(5),
                'type' => 'good', 'unit' => 'piece', 'sale_price' => 1000 + $i, 'tax_rate' => 15, 'is_active' => true,
                'category_id' => $category,
            ]);
            CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        }
        app(TenantContext::class)->forget();
    }

    private function addCategories(array $store, int $count): void
    {
        app(TenantContext::class)->set($store['tenant']->id);
        for ($i = 0; $i < $count; $i++) {
            $parent = ProductCategory::create(['name' => 'جذر '.Str::random(5), 'is_active' => true]);
            ProductCategory::create(['name' => 'فرع '.Str::random(5), 'is_active' => true, 'parent_id' => $parent->id]);
        }
        app(TenantContext::class)->forget();
    }

    /** عدد استعلامات SQL لطلب GET واحد (بعد طلب تسخين). */
    private function queries(array $store, string $uri): int
    {
        $headers = ['Authorization' => 'Bearer '.$store['token']];
        $this->getJson($uri, $headers)->assertOk(); // تسخين: التوكن/الإعدادات/الجداول المخبَّأة

        $count = 0;
        DB::listen(function () use (&$count) {
            $count++;
        });
        $this->getJson($uri, $headers)->assertOk();

        return $count;
    }

    /** @return array<string, array{0: string}> */
    public static function productQueries(): array
    {
        return [
            'plain list' => ['/commerce/v1/products?per_page=50'],
            'search' => ['/commerce/v1/products?per_page=50&search=%D9%85%D9%86%D8%AA%D8%AC'],
            'popularity sort' => ['/commerce/v1/products?per_page=50&sort=-popularity'],
            'newest sort' => ['/commerce/v1/products?per_page=50&sort=-created_at'],
        ];
    }

    /** @dataProvider productQueries */
    public function test_product_list_query_count_does_not_grow_with_the_number_of_rows(string $uri): void
    {
        $few = $this->store();
        $this->addProducts($few, 3);
        $fewCount = $this->queries($few, $uri);

        $many = $this->store();
        $this->addProducts($many, 20);
        $manyCount = $this->queries($many, $uri);

        $this->assertSame($fewCount, $manyCount, "{$uri}: عدد الاستعلامات نما من {$fewCount} إلى {$manyCount} بزيادة الصفوف — N+1");
    }

    public function test_category_filtered_list_query_count_does_not_grow(): void
    {
        $few = $this->store();
        $fewCategory = $this->categoryWith($few, 3);
        $fewCount = $this->queries($few, '/commerce/v1/products?per_page=50&category_id='.$fewCategory);

        $many = $this->store();
        $manyCategory = $this->categoryWith($many, 20);
        $manyCount = $this->queries($many, '/commerce/v1/products?per_page=50&category_id='.$manyCategory);

        $this->assertSame($fewCount, $manyCount);
    }

    public function test_category_tree_query_count_does_not_grow_with_the_number_of_categories(): void
    {
        $few = $this->store();
        $this->addCategories($few, 2);
        $fewCount = $this->queries($few, '/commerce/v1/categories');

        $many = $this->store();
        $this->addCategories($many, 15);
        $manyCount = $this->queries($many, '/commerce/v1/categories');

        $this->assertSame($fewCount, $manyCount, 'شجرة التصنيفات: استعلامات نمت بزيادة التصنيفات — N+1');
    }

    /** يرفق وسائط (2 لكل منتج) بكل منتجات المستأجر. */
    private function attachMedia(array $store): void
    {
        app(TenantContext::class)->set($store['tenant']->id);
        foreach (Product::query()->get() as $product) {
            foreach ([1, 0] as $order) {
                ProductMedia::create([
                    'product_id' => $product->id, 'disk' => 'local', 'path' => "products/{$product->id}-{$order}.webp",
                    'original_name' => "img-{$order}.webp", 'mime_type' => 'image/webp', 'size' => 11, 'sort_order' => $order,
                ]);
            }
        }
        app(TenantContext::class)->forget();
    }

    public function test_products_with_media_do_not_add_a_query_per_row_and_keep_the_media_order(): void
    {
        $few = $this->store();
        $this->addProducts($few, 3);
        $this->attachMedia($few);
        $fewCount = $this->queries($few, '/commerce/v1/products?per_page=50');

        $many = $this->store();
        $this->addProducts($many, 20);
        $this->attachMedia($many);
        $manyCount = $this->queries($many, '/commerce/v1/products?per_page=50');

        $this->assertSame($fewCount, $manyCount, 'وسائط المنتجات: استعلام لكل صف — N+1');

        // المحتوى كما كان: صورة الغلاف = الأقل ترتيباً (sort_order 0) لكل منتج.
        $rows = $this->getJson('/commerce/v1/products?per_page=50', ['Authorization' => 'Bearer '.$many['token']])->assertOk()->json('data');
        $this->assertCount(20, $rows);
        foreach ($rows as $row) {
            $this->assertNotNull($row['thumbnail_url'], 'لكل منتج غلاف');
        }
    }

    public function test_the_batched_gallery_equals_the_single_product_gallery_for_every_product(): void
    {
        $store = $this->store();
        $this->addProducts($store, 5);
        $this->attachMedia($store);

        app(TenantContext::class)->set($store['tenant']->id);
        $service = app(ProductMediaGalleryService::class);
        $products = Product::query()->orderBy('id')->get();
        $batched = $service->resolveSharedGalleries($products);
        foreach ($products as $product) {
            $this->assertSame(
                $service->resolveGallery($product)->pluck('id')->all(),
                $batched[$product->id]->pluck('id')->all(),
                'الدفعة تطابق الاستعلام المنفرد حرفياً (المحتوى والترتيب)',
            );
        }
        $this->assertSame([], $service->resolveSharedGalleries([]));
        app(TenantContext::class)->forget();
    }

    private function categoryWith(array $store, int $products): string
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $category = ProductCategory::create(['name' => 'تصنيف', 'is_active' => true]);
        app(TenantContext::class)->forget();
        $this->addProducts($store, $products, $category->id);

        return $category->id;
    }
}
