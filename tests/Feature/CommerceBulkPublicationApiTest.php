<?php

namespace Tests\Feature;

use App\Models\CommerceCategoryListing;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * COM-CATALOG-3 — Bulk publish / unpublish for the Published Products screen.
 *
 * يثبت: الأثر على المعرّفات الصريحة وحدها وعلى متجر واحد وحدها، عزل المستأجر
 * (معرّف أجنبي = rejected/not_found بلا كتابة، متجر أجنبي/معطَّل = 422)، RBAC
 * (products.manage فقط؛ staff وself_service ممنوعان)، عزل فشل السجل الواحد،
 * idempotency، استقلال المنتجات عن التصنيفات، وأن لا شيء مالي/مخزني يُمسّ.
 *
 * تشغيل: php artisan test --filter=CommerceBulkPublicationApiTest
 */
class CommerceBulkPublicationApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const PRODUCTS = '/api/commerce/workspace/products/publication/bulk';
    private const CATEGORIES = '/api/commerce/workspace/categories/publication/bulk';

    /** @return array{storefront: Storefront, channel: SalesChannel} */
    private function seedStore(string $tenantId, string $suffix, bool $active = true): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::create([
            'slug' => 'bulk-web-'.$suffix,
            'name' => 'ويب '.$suffix,
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'bulk-store-'.$suffix,
            'name' => 'متجر '.$suffix,
            'sales_channel_id' => $channel->id,
            'is_active' => $active,
        ]);
        app(TenantContext::class)->forget();

        return compact('storefront', 'channel');
    }

    /** @return list<Product> */
    private function seedProducts(string $tenantId, string $suffix, int $count): array
    {
        app(TenantContext::class)->set($tenantId);
        $products = [];
        for ($i = 1; $i <= $count; $i++) {
            $products[] = Product::create([
                'name' => "منتج {$suffix}-{$i}",
                'sku' => "BULK-{$suffix}-{$i}",
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 10000,
                'purchase_price' => 5000,
                'tax_rate' => 15,
                'is_active' => true,
            ]);
        }
        app(TenantContext::class)->forget();

        return $products;
    }

    /** @return list<ProductCategory> */
    private function seedCategories(string $tenantId, string $suffix, int $count): array
    {
        app(TenantContext::class)->set($tenantId);
        $categories = [];
        for ($i = 1; $i <= $count; $i++) {
            $categories[] = ProductCategory::create(['name' => "تصنيف {$suffix}-{$i}", 'is_active' => true]);
        }
        app(TenantContext::class)->forget();

        return $categories;
    }

    private function productPublished(string $tenantId, Product $product, SalesChannel $channel): bool
    {
        app(TenantContext::class)->set($tenantId);
        $published = CommerceListing::query()
            ->where('product_id', $product->id)
            ->where('sales_channel_id', $channel->id)
            ->where('is_published', true)->exists();
        app(TenantContext::class)->forget();

        return $published;
    }

    private function categoryPublished(string $tenantId, ProductCategory $category, SalesChannel $channel): bool
    {
        app(TenantContext::class)->set($tenantId);
        $published = CommerceCategoryListing::query()
            ->where('category_id', $category->id)
            ->where('sales_channel_id', $channel->id)
            ->where('is_published', true)->exists();
        app(TenantContext::class)->forget();

        return $published;
    }

    private function listingCount(string $tenantId): int
    {
        app(TenantContext::class)->set($tenantId);
        $count = CommerceListing::query()->count() + CommerceCategoryListing::query()->count();
        app(TenantContext::class)->forget();

        return $count;
    }

    // ── Products ───────────────────────────────────────────────────────────

    /** @test */
    public function bulk_publish_affects_only_the_selected_products_on_the_chosen_store(): void
    {
        $auth = $this->registerTenant('bulk-p1', 'bulk-p1@example.test');
        $store = $this->seedStore($auth['tenant_id'], 'p1');
        [$a, $b, $c] = $this->seedProducts($auth['tenant_id'], 'p1', 3);

        $response = $this->withToken($auth['token'])->postJson(self::PRODUCTS, [
            'action' => 'publish',
            'storefront_id' => $store['storefront']->id,
            'ids' => [$a->id, $b->id],
        ])->assertOk()
            ->assertJsonPath('data.action', 'publish')
            ->assertJsonPath('data.summary.requested', 2)
            ->assertJsonPath('data.summary.updated', 2)
            ->assertJsonPath('data.summary.rejected', 0)
            ->assertJsonPath('data.summary.failed', 0);

        $this->assertSame(['updated', 'updated'], array_column($response->json('data.results'), 'status'));
        $this->assertTrue($this->productPublished($auth['tenant_id'], $a, $store['channel']));
        $this->assertTrue($this->productPublished($auth['tenant_id'], $b, $store['channel']));
        // غير المحدد لا يُمسّ — ولا يُنشأ له صف.
        $this->assertFalse($this->productPublished($auth['tenant_id'], $c, $store['channel']));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(CommerceListing::query()->where('product_id', $c->id)->exists());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function bulk_unpublish_and_repeat_are_idempotent(): void
    {
        $auth = $this->registerTenant('bulk-p2', 'bulk-p2@example.test');
        $store = $this->seedStore($auth['tenant_id'], 'p2');
        [$a, $b] = $this->seedProducts($auth['tenant_id'], 'p2', 2);
        $publish = ['action' => 'publish', 'storefront_id' => $store['storefront']->id, 'ids' => [$a->id]];

        $this->withToken($auth['token'])->postJson(self::PRODUCTS, $publish)
            ->assertOk()->assertJsonPath('data.summary.updated', 1);
        // إعادة النشر نفسه = unchanged بلا كتابة.
        $this->withToken($auth['token'])->postJson(self::PRODUCTS, $publish)
            ->assertOk()->assertJsonPath('data.summary.updated', 0)->assertJsonPath('data.summary.unchanged', 1);

        $this->withToken($auth['token'])->postJson(self::PRODUCTS, [
            'action' => 'unpublish',
            'storefront_id' => $store['storefront']->id,
            'ids' => [$a->id, $b->id],
        ])->assertOk()
            ->assertJsonPath('data.summary.updated', 1)
            // $b لم يُنشر قط: لا شيء لفعله ولا صف يُنشأ.
            ->assertJsonPath('data.summary.unchanged', 1);

        $this->assertFalse($this->productPublished($auth['tenant_id'], $a, $store['channel']));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(CommerceListing::query()->where('product_id', $b->id)->exists());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function bulk_never_touches_other_stores_of_the_same_tenant(): void
    {
        $auth = $this->registerTenant('bulk-p3', 'bulk-p3@example.test');
        $one = $this->seedStore($auth['tenant_id'], 'p3a');
        $two = $this->seedStore($auth['tenant_id'], 'p3b');
        [$a] = $this->seedProducts($auth['tenant_id'], 'p3', 1);

        // منشور مسبقاً على المتجر ٢ فقط.
        app(TenantContext::class)->set($auth['tenant_id']);
        CommerceListing::query()->create([
            'product_id' => $a->id, 'sales_channel_id' => $two['channel']->id,
            'tenant_id' => $auth['tenant_id'], 'is_published' => true,
        ]);
        app(TenantContext::class)->forget();

        // نشر جماعي على المتجر ١ لا يغيّر المتجر ٢، وإلغاء النشر على ١ لا يلغيه على ٢.
        $this->withToken($auth['token'])->postJson(self::PRODUCTS, [
            'action' => 'publish', 'storefront_id' => $one['storefront']->id, 'ids' => [$a->id],
        ])->assertOk();
        $this->assertTrue($this->productPublished($auth['tenant_id'], $a, $one['channel']));
        $this->assertTrue($this->productPublished($auth['tenant_id'], $a, $two['channel']));

        $this->withToken($auth['token'])->postJson(self::PRODUCTS, [
            'action' => 'unpublish', 'storefront_id' => $one['storefront']->id, 'ids' => [$a->id],
        ])->assertOk();
        $this->assertFalse($this->productPublished($auth['tenant_id'], $a, $one['channel']));
        $this->assertTrue($this->productPublished($auth['tenant_id'], $a, $two['channel']));
    }

    /** @test */
    public function foreign_tenant_product_ids_are_rejected_without_any_write_or_leak(): void
    {
        $a = $this->registerTenant('bulk-p4a', 'bulk-p4a@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('bulk-p4b', 'bulk-p4b@example.test');
        $storeA = $this->seedStore($a['tenant_id'], 'p4a');
        [$mine] = $this->seedProducts($a['tenant_id'], 'p4a', 1);
        [$theirs] = $this->seedProducts($b['tenant_id'], 'p4b', 1);
        $missing = '00000000-0000-4000-8000-000000000001';

        $response = $this->withToken($a['token'])->postJson(self::PRODUCTS, [
            'action' => 'publish',
            'storefront_id' => $storeA['storefront']->id,
            'ids' => [$mine->id, $theirs->id, $missing],
        ])->assertOk()
            ->assertJsonPath('data.summary.updated', 1)
            ->assertJsonPath('data.summary.rejected', 2);

        // الأجنبي والمفقود غير متمايزين: السبب نفسه.
        $byId = collect($response->json('data.results'))->keyBy('id');
        $this->assertSame('rejected', $byId[$theirs->id]['status']);
        $this->assertSame('not_found', $byId[$theirs->id]['reason']);
        $this->assertSame($byId[$missing]['reason'], $byId[$theirs->id]['reason']);
        $this->assertSame('updated', $byId[$mine->id]['status']);
        $this->assertSame(0, $this->listingCount($b['tenant_id']));
    }

    /** @test */
    public function foreign_inactive_or_malformed_storefront_is_rejected_before_any_write(): void
    {
        $a = $this->registerTenant('bulk-p5a', 'bulk-p5a@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('bulk-p5b', 'bulk-p5b@example.test');
        $storeB = $this->seedStore($b['tenant_id'], 'p5b');
        $inactive = $this->seedStore($a['tenant_id'], 'p5i', false);
        [$mine] = $this->seedProducts($a['tenant_id'], 'p5', 1);

        foreach ([$storeB['storefront']->id, $inactive['storefront']->id] as $storefrontId) {
            $this->withToken($a['token'])->postJson(self::PRODUCTS, [
                'action' => 'publish', 'storefront_id' => $storefrontId, 'ids' => [$mine->id],
            ])->assertUnprocessable();
        }
        $this->withToken($a['token'])->postJson(self::PRODUCTS, [
            'action' => 'publish', 'storefront_id' => 'not-a-uuid', 'ids' => [$mine->id],
        ])->assertUnprocessable();

        $this->assertSame(0, $this->listingCount($a['tenant_id']));
        $this->assertSame(0, $this->listingCount($b['tenant_id']));
    }

    /** @test */
    public function one_record_failure_does_not_roll_back_the_others(): void
    {
        $auth = $this->registerTenant('bulk-p6', 'bulk-p6@example.test');
        $store = $this->seedStore($auth['tenant_id'], 'p6');
        [$a, $b, $c] = $this->seedProducts($auth['tenant_id'], 'p6', 3);

        CommerceListing::creating(function (CommerceListing $listing) use ($b): void {
            if ($listing->product_id === $b->id) {
                throw new \RuntimeException('simulated write failure');
            }
        });

        $response = $this->withToken($auth['token'])->postJson(self::PRODUCTS, [
            'action' => 'publish',
            'storefront_id' => $store['storefront']->id,
            'ids' => [$a->id, $b->id, $c->id],
        ])->assertOk()
            ->assertJsonPath('data.summary.updated', 2)
            ->assertJsonPath('data.summary.failed', 1);

        $byId = collect($response->json('data.results'))->keyBy('id');
        $this->assertSame('failed', $byId[$b->id]['status']);
        $this->assertTrue($this->productPublished($auth['tenant_id'], $a, $store['channel']));
        $this->assertFalse($this->productPublished($auth['tenant_id'], $b, $store['channel']));
        $this->assertTrue($this->productPublished($auth['tenant_id'], $c, $store['channel']));
    }

    /** @test */
    public function bulk_rbac_requires_products_manage_and_denies_self_service(): void
    {
        $auth = $this->registerTenant('bulk-p7', 'bulk-p7@example.test');
        $store = $this->seedStore($auth['tenant_id'], 'p7');
        [$a] = $this->seedProducts($auth['tenant_id'], 'p7', 1);
        $body = ['action' => 'publish', 'storefront_id' => $store['storefront']->id, 'ids' => [$a->id]];

        $this->postJson(self::PRODUCTS, $body)->assertUnauthorized();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff-bulk-p7@example.test');
        $this->withToken($staff)->postJson(self::PRODUCTS, $body)->assertForbidden();
        $self = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self-bulk-p7@example.test');
        $this->withToken($self)->postJson(self::PRODUCTS, $body)->assertForbidden();

        $this->assertFalse($this->productPublished($auth['tenant_id'], $a, $store['channel']));
    }

    /** @test */
    public function bulk_validates_the_request_shape_and_caps_the_batch(): void
    {
        $auth = $this->registerTenant('bulk-p8', 'bulk-p8@example.test');
        $store = $this->seedStore($auth['tenant_id'], 'p8');
        [$a] = $this->seedProducts($auth['tenant_id'], 'p8', 1);
        $sid = $store['storefront']->id;
        $tooMany = array_map(fn (int $i) => sprintf('00000000-0000-4000-8000-%012d', $i), range(1, 101));

        foreach ([
            ['storefront_id' => $sid, 'ids' => [$a->id]],                                  // لا action
            ['action' => 'delete', 'storefront_id' => $sid, 'ids' => [$a->id]],            // action مجهول
            ['action' => 'publish', 'ids' => [$a->id]],                                    // لا متجر (لا «كل المتاجر»)
            ['action' => 'publish', 'storefront_id' => $sid],                              // لا ids
            ['action' => 'publish', 'storefront_id' => $sid, 'ids' => []],                 // فارغة
            ['action' => 'publish', 'storefront_id' => $sid, 'ids' => ['x']],              // غير UUID
            ['action' => 'publish', 'storefront_id' => $sid, 'ids' => [$a->id, $a->id]],   // مكرر
            ['action' => 'publish', 'storefront_id' => $sid, 'ids' => $tooMany],           // فوق السقف
        ] as $body) {
            $this->withToken($auth['token'])->postJson(self::PRODUCTS, $body)->assertUnprocessable();
        }
        $this->assertSame(0, $this->listingCount($auth['tenant_id']));
    }

    // ── Categories ─────────────────────────────────────────────────────────

    /** @test */
    public function bulk_publish_and_unpublish_categories_only_touch_selected_ones(): void
    {
        $auth = $this->registerTenant('bulk-c1', 'bulk-c1@example.test');
        $store = $this->seedStore($auth['tenant_id'], 'c1');
        [$a, $b, $c] = $this->seedCategories($auth['tenant_id'], 'c1', 3);

        $this->withToken($auth['token'])->postJson(self::CATEGORIES, [
            'action' => 'publish', 'storefront_id' => $store['storefront']->id, 'ids' => [$a->id, $b->id],
        ])->assertOk()->assertJsonPath('data.summary.updated', 2);

        $this->assertTrue($this->categoryPublished($auth['tenant_id'], $a, $store['channel']));
        $this->assertTrue($this->categoryPublished($auth['tenant_id'], $b, $store['channel']));
        $this->assertFalse($this->categoryPublished($auth['tenant_id'], $c, $store['channel']));

        $this->withToken($auth['token'])->postJson(self::CATEGORIES, [
            'action' => 'unpublish', 'storefront_id' => $store['storefront']->id, 'ids' => [$a->id],
        ])->assertOk()->assertJsonPath('data.summary.updated', 1);
        $this->assertFalse($this->categoryPublished($auth['tenant_id'], $a, $store['channel']));
        $this->assertTrue($this->categoryPublished($auth['tenant_id'], $b, $store['channel']));
    }

    /** @test */
    public function category_bulk_rejects_foreign_ids_foreign_stores_and_unauthorized_roles(): void
    {
        $a = $this->registerTenant('bulk-c2a', 'bulk-c2a@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('bulk-c2b', 'bulk-c2b@example.test');
        $storeA = $this->seedStore($a['tenant_id'], 'c2a');
        $storeB = $this->seedStore($b['tenant_id'], 'c2b');
        [$mine] = $this->seedCategories($a['tenant_id'], 'c2a', 1);
        [$theirs] = $this->seedCategories($b['tenant_id'], 'c2b', 1);

        $this->withToken($a['token'])->postJson(self::CATEGORIES, [
            'action' => 'publish', 'storefront_id' => $storeA['storefront']->id, 'ids' => [$mine->id, $theirs->id],
        ])->assertOk()
            ->assertJsonPath('data.summary.updated', 1)
            ->assertJsonPath('data.summary.rejected', 1);
        $this->assertFalse($this->categoryPublished($b['tenant_id'], $theirs, $storeB['channel']));

        $this->withToken($a['token'])->postJson(self::CATEGORIES, [
            'action' => 'publish', 'storefront_id' => $storeB['storefront']->id, 'ids' => [$mine->id],
        ])->assertUnprocessable();

        $body = ['action' => 'unpublish', 'storefront_id' => $storeA['storefront']->id, 'ids' => [$mine->id]];
        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff-bulk-c2@example.test');
        $this->withToken($staff)->postJson(self::CATEGORIES, $body)->assertForbidden();
        $self = $this->tokenForRole($a['tenant_id'], 'self_service', 'self-bulk-c2@example.test');
        $this->withToken($self)->postJson(self::CATEGORIES, $body)->assertForbidden();
        $this->assertTrue($this->categoryPublished($a['tenant_id'], $mine, $storeA['channel']));
    }

    /** @test */
    public function product_and_category_bulk_are_fully_independent(): void
    {
        $auth = $this->registerTenant('bulk-x1', 'bulk-x1@example.test');
        $store = $this->seedStore($auth['tenant_id'], 'x1');
        [$product] = $this->seedProducts($auth['tenant_id'], 'x1', 1);
        [$category] = $this->seedCategories($auth['tenant_id'], 'x1', 1);

        $this->withToken($auth['token'])->postJson(self::PRODUCTS, [
            'action' => 'publish', 'storefront_id' => $store['storefront']->id, 'ids' => [$product->id],
        ])->assertOk();
        $this->assertFalse($this->categoryPublished($auth['tenant_id'], $category, $store['channel']));

        $this->withToken($auth['token'])->postJson(self::CATEGORIES, [
            'action' => 'publish', 'storefront_id' => $store['storefront']->id, 'ids' => [$category->id],
        ])->assertOk();
        $this->withToken($auth['token'])->postJson(self::CATEGORIES, [
            'action' => 'unpublish', 'storefront_id' => $store['storefront']->id, 'ids' => [$category->id],
        ])->assertOk();
        // إلغاء نشر التصنيف لا يلغي نشر المنتج.
        $this->assertTrue($this->productPublished($auth['tenant_id'], $product, $store['channel']));

        // الدفع بالمنتج لم يمسّ المخزون: لا حركة مخزون ولا قيد.
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, \App\Models\StockMovement::query()->count());
        $this->assertSame(0, \App\Models\JournalEntry::query()->count());
        app(TenantContext::class)->forget();
    }
}
