<?php

namespace Tests\Feature;

use App\Models\ApiClient;
use App\Models\CommerceCollection;
use App\Models\CommerceCollectionProduct;
use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceListing;
use App\Models\CommerceProductFacetValue;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * FLOWERS-H2 / ADR-14 §2.3 — المجموعات التسويقية اليدوية: الإدارة، العضوية
 * المرتّبة، العزل، RBAC، والقراءة العامة (store/v1 + commerce/v1) المبوَّبة بنشر المنتج.
 *
 * تشغيل: php artisan test --filter=CommerceCollectionApiTest
 */
class CommerceCollectionApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/commerce/workspace/collections';

    private function makeProduct(string $tenantId, string $name): Product
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create(['name' => $name, 'type' => 'goods', 'unit' => 'pcs', 'sale_price' => 100, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function createCollection(string $token, array $over = []): array
    {
        return $this->withToken($token)->postJson(self::BASE, array_merge([
            'title' => 'الأكثر مبيعاً', 'title_en' => 'Best sellers', 'status' => 'active',
        ], $over))->assertCreated()->json('data.collection');
    }

    /** @return array{tenant: Tenant, channel: SalesChannel} */
    private function publicStore(string $slug, string $type = SalesChannel::TYPE_WEB): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => $type, 'name' => 'قناة', 'type' => $type, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    private function publish(Tenant $tenant, SalesChannel $channel, string $name, bool $published = true): Product
    {
        $product = $this->makeProduct($tenant->id, $name);
        if ($published) {
            app(TenantContext::class)->set($tenant->id);
            CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
            app(TenantContext::class)->forget();
        }

        return $product;
    }

    private function collect(Tenant $tenant, string $slug, array $products, string $status = 'active'): CommerceCollection
    {
        app(TenantContext::class)->set($tenant->id);
        $collection = CommerceCollection::create(['slug' => $slug, 'title' => $slug, 'status' => $status]);
        foreach (array_values($products) as $i => $product) {
            CommerceCollectionProduct::create(['commerce_collection_id' => $collection->id, 'product_id' => $product->id, 'position' => $i]);
        }
        app(TenantContext::class)->forget();

        return $collection;
    }

    // ── الإدارة ────────────────────────────────────────────────────────

    /** @test */
    public function an_owner_manages_collections_and_the_slug_is_derived_and_unique(): void
    {
        $auth = $this->registerTenant('col-crud', 'owner@col-crud.test');
        $first = $this->createCollection($auth['token']);
        $second = $this->createCollection($auth['token'], ['title_en' => 'Best Sellers!']);

        $this->assertSame('best-sellers', $first['slug']);
        $this->assertSame('best-sellers-2', $second['slug']);
        $this->assertSame('active', $first['status']);

        $this->withToken($auth['token'])->postJson(self::BASE, ['title' => 'x', 'slug' => 'best-sellers'])->assertStatus(409);
        $this->withToken($auth['token'])->putJson(self::BASE."/{$second['id']}", ['slug' => 'best-sellers'])->assertStatus(409);

        $upd = $this->withToken($auth['token'])->putJson(self::BASE."/{$first['id']}", ['title' => 'مختارات', 'status' => 'draft'])->assertOk();
        $this->assertSame('draft', $upd->json('data.collection.status'));

        foreach ([['title' => '  '], ['title' => 'x', 'status' => 'live'], ['title' => 'x', 'slug' => 'Bad Slug']] as $bad) {
            $this->withToken($auth['token'])->postJson(self::BASE, $bad)->assertStatus(422);
        }

        $this->withToken($auth['token'])->deleteJson(self::BASE."/{$second['id']}")->assertOk();
        $this->assertCount(1, $this->withToken($auth['token'])->getJson(self::BASE)->json('data.collections'));
    }

    /** @test */
    public function membership_is_ordered_idempotent_and_replaces_as_a_set(): void
    {
        $auth = $this->registerTenant('col-members', 'owner@col-members.test');
        $collection = $this->createCollection($auth['token']);
        $a = $this->makeProduct($auth['tenant_id'], 'أ');
        $b = $this->makeProduct($auth['tenant_id'], 'ب');
        $c = $this->makeProduct($auth['tenant_id'], 'ج');
        $url = self::BASE."/{$collection['id']}/products";

        $this->withToken($auth['token'])->putJson($url, ['product_ids' => [$c->id, $a->id, $b->id]])->assertOk();
        $this->withToken($auth['token'])->putJson($url, ['product_ids' => [$c->id, $a->id, $b->id]])->assertOk();
        $this->assertSame([$c->id, $a->id, $b->id], array_column($this->withToken($auth['token'])->getJson($url)->json('data.products'), 'product_id'));

        $this->withToken($auth['token'])->putJson($url, ['product_ids' => [$b->id, $c->id]])->assertOk();
        $rows = $this->withToken($auth['token'])->getJson($url)->json('data.products');
        $this->assertSame([$b->id, $c->id], array_column($rows, 'product_id'));
        $this->assertSame([0, 1], array_column($rows, 'position'));

        $list = $this->withToken($auth['token'])->getJson(self::BASE)->json('data.collections');
        $this->assertSame(2, $list[0]['member_count']);

        // مكرر → 422 (distinct)، معرّف غير موجود → 422
        $this->withToken($auth['token'])->putJson($url, ['product_ids' => [$a->id, $a->id]])->assertStatus(422);
        $this->withToken($auth['token'])->putJson($url, ['product_ids' => [(string) Str::uuid()]])->assertStatus(422);
    }

    /** @test */
    public function foreign_tenant_collections_and_products_are_isolated(): void
    {
        $a = $this->registerTenant('col-iso-a', 'owner@col-iso-a.test');
        $b = $this->registerTenant('col-iso-b', 'owner@col-iso-b.test');
        $colB = $this->createCollection($b['token']);
        $productA = $this->makeProduct($a['tenant_id'], 'منتج أ');
        $productB = $this->makeProduct($b['tenant_id'], 'منتج ب');
        $colA = $this->createCollection($a['token'], ['title_en' => 'Mine']);

        // منتج مستأجر آخر في مجموعتي
        $this->withToken($a['token'])->putJson(self::BASE."/{$colA['id']}/products", ['product_ids' => [$productB->id]])->assertStatus(422);
        // مجموعة مستأجر آخر: 404 غير كاشف على كل الأفعال
        $this->withToken($a['token'])->putJson(self::BASE."/{$colB['id']}", ['title' => 'استيلاء'])->assertNotFound();
        $this->withToken($a['token'])->deleteJson(self::BASE."/{$colB['id']}")->assertNotFound();
        $this->withToken($a['token'])->getJson(self::BASE."/{$colB['id']}/products")->assertNotFound();
        $this->withToken($a['token'])->putJson(self::BASE."/{$colB['id']}/products", ['product_ids' => [$productA->id]])->assertNotFound();

        $this->assertSame(0, CommerceCollectionProduct::withoutGlobalScopes()->count());
        $this->assertSame('الأكثر مبيعاً', CommerceCollection::withoutGlobalScopes()->find($colB['id'])->title);
    }

    /** @test */
    public function models_reject_cross_tenant_links_and_unknown_status(): void
    {
        $a = $this->registerTenant('col-mod-a', 'owner@col-mod-a.test');
        $b = $this->registerTenant('col-mod-b', 'owner@col-mod-b.test');
        $colB = $this->createCollection($b['token']);
        $productA = $this->makeProduct($a['tenant_id'], 'منتج أ');

        app(TenantContext::class)->set($a['tenant_id']);
        try {
            CommerceCollectionProduct::create(['commerce_collection_id' => $colB['id'], 'product_id' => $productA->id]);
            $this->fail('membership in a foreign collection was accepted');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        try {
            CommerceCollection::create(['slug' => 'x', 'title' => 'x', 'status' => 'live']);
            $this->fail('unknown status accepted');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
    }

    /** @test */
    public function rbac_and_guests(): void
    {
        $auth = $this->registerTenant('col-rbac', 'owner@col-rbac.test');
        $collection = $this->createCollection($auth['token']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@col-rbac.test');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@col-rbac.test');

        $this->withToken($staff)->getJson(self::BASE)->assertOk();
        $this->withToken($staff)->postJson(self::BASE, ['title' => 'x'])->assertForbidden();
        $this->withToken($staff)->deleteJson(self::BASE."/{$collection['id']}")->assertForbidden();
        $this->withToken($ss)->getJson(self::BASE)->assertForbidden();
        $this->withToken($ss)->putJson(self::BASE."/{$collection['id']}/products", ['product_ids' => []])->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $this->getJson(self::BASE)->assertUnauthorized();
    }

    // ── القراءة العامة ─────────────────────────────────────────────────

    /** @test */
    public function the_public_list_shows_only_active_collections_with_published_member_counts(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->publicStore('pub');
        $p1 = $this->publish($tenant, $channel, 'منشور 1');
        $p2 = $this->publish($tenant, $channel, 'منشور 2');
        $hidden = $this->publish($tenant, $channel, 'غير منشور', false);

        $this->collect($tenant, 'best', [$p1, $p2, $hidden]);
        $this->collect($tenant, 'draft-one', [$p1], 'draft');
        $this->collect($tenant, 'only-hidden', [$hidden]);
        $this->collect($tenant, 'empty', []);

        $res = $this->getJson("/store/v1/{$tenant->slug}/collections")->assertOk();

        $this->assertSame(['best'], array_column($res->json('data'), 'slug'));
        $this->assertSame(2, $res->json('data.0.product_count')); // غير المنشور لا يُعدّ
        $this->assertArrayNotHasKey('tenant_id', $res->json('data.0'));
    }

    /** @test */
    public function collection_members_are_read_via_the_product_list_in_the_merchants_order(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->publicStore('ord');
        $a = $this->publish($tenant, $channel, 'أ');
        $b = $this->publish($tenant, $channel, 'ب');
        $c = $this->publish($tenant, $channel, 'ج');
        $hidden = $this->publish($tenant, $channel, 'مخفي', false);
        $other = $this->publish($tenant, $channel, 'خارج المجموعة');
        $this->collect($tenant, 'curated', [$c, $a, $hidden, $b]);

        $res = $this->getJson("/store/v1/{$tenant->slug}/products?collection=curated")->assertOk();
        $this->assertSame(['ج', 'أ', 'ب'], array_column($res->json('data'), 'name'));
        $this->assertNotContains($other->id, array_column($res->json('data'), 'id'));

        // sort صريح يغلب ترتيب التاجر
        $sorted = $this->getJson("/store/v1/{$tenant->slug}/products?collection=curated&sort=name")->assertOk();
        $names = array_column($sorted->json('data'), 'name');
        $expected = $names;
        sort($expected);
        $this->assertSame($expected, $names);
    }

    /** @test */
    public function unknown_or_draft_collections_fail_closed_and_other_tenants_collections_are_unreachable(): void
    {
        ['tenant' => $a, 'channel' => $chA] = $this->publicStore('iso-a');
        ['tenant' => $b, 'channel' => $chB] = $this->publicStore('iso-b');
        $pa = $this->publish($a, $chA, 'منتج أ');
        $pb = $this->publish($b, $chB, 'منتج ب');
        $this->collect($a, 'shared-slug', [$pa], 'draft');
        $this->collect($b, 'shared-slug', [$pb]);
        $this->collect($b, 'b-only', [$pb]);

        $this->assertSame([], $this->getJson("/store/v1/{$a->slug}/products?collection=nope")->json('data'));
        $this->assertSame([], $this->getJson("/store/v1/{$a->slug}/products?collection=shared-slug")->json('data')); // مسودة
        $this->assertSame([], $this->getJson("/store/v1/{$a->slug}/products?collection=b-only")->json('data')); // لمستأجر آخر
        $this->assertSame(['منتج ب'], array_column($this->getJson("/store/v1/{$b->slug}/products?collection=shared-slug")->json('data'), 'name'));
    }

    /** @test */
    public function facet_counts_are_computed_inside_the_collection_context(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->publicStore('ctx');
        $in1 = $this->publish($tenant, $channel, 'داخل 1');
        $in2 = $this->publish($tenant, $channel, 'داخل 2');
        $out = $this->publish($tenant, $channel, 'خارج');
        $this->collect($tenant, 'ctx-col', [$in1, $in2]);

        app(TenantContext::class)->set($tenant->id);
        $facet = CommerceFacet::create(['key' => 'occasion', 'name' => 'المناسبة']);
        $birthday = CommerceFacetValue::create(['commerce_facet_id' => $facet->id, 'slug' => 'birthday', 'name' => 'ميلاد']);
        foreach ([$in1, $out] as $p) {
            CommerceProductFacetValue::create(['product_id' => $p->id, 'commerce_facet_value_id' => $birthday->id]);
        }
        app(TenantContext::class)->forget();

        $res = $this->getJson("/store/v1/{$tenant->slug}/products?collection=ctx-col")->assertOk();
        $this->assertSame(1, $res->json('meta.facets.0.values.0.count')); // 2 لو تسرّب «خارج»
    }

    /** @test */
    public function the_mobile_catalog_lists_collections_and_filters_members(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->publicStore('mob', SalesChannel::TYPE_MOBILE);
        $a = $this->publish($tenant, $channel, 'ورد');
        $this->collect($tenant, 'mobile-col', [$a]);

        $service = app(ApiClientKeyService::class);
        $client = $service->createClient($tenant, 'mobile-app', true);
        $headers = ['Authorization' => 'Bearer '.$service->issueKey($client, 'default', [])->plainTextToken];

        $list = $this->getJson('/commerce/v1/collections', $headers)->assertOk();
        $this->assertSame('mobile-col', $list->json('data.0.slug'));
        $this->assertSame(1, $list->json('data.0.product_count'));

        $members = $this->getJson('/commerce/v1/products?collection=mobile-col', $headers)->assertOk();
        $this->assertSame(['ورد'], array_column($members->json('data'), 'name'));
    }
}
