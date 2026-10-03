<?php

namespace Tests\Feature;

use App\Models\CommerceCategoryListing;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CUST-H2-3 — Workspace Product read API (قائمة/تفصيل) لمنتقي "معاينة منتج"
 * في مُخصِّص صفحة المنتج. يثبت العزل الكامل بين المستأجرين، قاعدة الأهلية
 * (نشط + منشور على قناة *هذا* المتجر تحديداً)، الحمولة المُصغَّرة الآمنة، وكل
 * سيناريوهات العزل الثمانية التي تفرضها المهمة.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceStorefrontProductApiTest
 */
class CommerceWorkspaceStorefrontProductApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function listPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/products';
    }

    private function itemPath(string $id, string $productId): string
    {
        return $this->listPath($id).'/'.$productId;
    }

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    private function seedWebStorefront(string $tenantId, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::create([
            'slug' => $overrides['channel_slug'] ?? 'web',
            'name' => 'ويب',
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ]);

        $storefront = Storefront::create([
            'slug' => $overrides['slug'] ?? 'main',
            'name' => $overrides['name'] ?? 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    private function seedProduct(SalesChannel $channel, array $attrs = [], bool $published = true): Product
    {
        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6),
            'name' => 'منتج منشور',
            'name_en' => 'Published Product',
            'type' => 'good',
            'unit' => 'piece',
            'sale_price' => 25000,
            'tax_rate' => 15,
            'is_active' => true,
            'avg_cost' => 9999,
            'purchase_price' => 8000,
            'quantity_on_hand' => 42,
            'internal_notes' => 'سرّي جداً — لا يظهر هنا أبداً',
            'tags' => 'internal-tag',
        ], $attrs));

        if ($published) {
            CommerceListing::create([
                'product_id' => $product->id,
                'sales_channel_id' => $channel->id,
                'is_published' => true,
            ]);
        }

        return $product->fresh();
    }

    // ───────────────────────── 1. Tenant isolation — list ─────────────────────────

    /** @test */
    public function tenant_a_lists_only_tenant_a_eligible_products(): void
    {
        $a = $this->registerTenant('prod-list-a', 'owner@prod-list-a.test');
        $b = $this->registerTenant('prod-list-b', 'owner@prod-list-b.test');

        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        app(TenantContext::class)->set($a['tenant_id']);
        $this->seedProduct($seededA['channel'], ['name' => 'منتج أ']);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->seedProduct($seededB['channel'], ['name' => 'منتج ب']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($a['token'])
            ->getJson($this->listPath($seededA['storefront']->id))
            ->assertOk();

        $names = array_column($res->json('data'), 'name');
        $this->assertSame(['منتج أ'], $names);
    }

    // ───────────────────────── 2/3. Foreign storefront/product → 404 ─────────────────────────

    /** @test */
    public function tenant_a_cannot_list_products_of_a_foreign_storefront(): void
    {
        $a = $this->registerTenant('prod-foreign-sf-a', 'owner@prod-foreign-sf-a.test');
        $b = $this->registerTenant('prod-foreign-sf-b', 'owner@prod-foreign-sf-b.test');
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $this->withToken($a['token'])
            ->getJson($this->listPath($seededB['storefront']->id))
            ->assertNotFound();
    }

    /** @test */
    public function a_foreign_product_id_returns_a_non_leaking_404(): void
    {
        $a = $this->registerTenant('prod-foreign-a', 'owner@prod-foreign-a.test');
        $b = $this->registerTenant('prod-foreign-b', 'owner@prod-foreign-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        app(TenantContext::class)->set($b['tenant_id']);
        $foreignProduct = $this->seedProduct($seededB['channel'], ['name' => 'منتج أجنبي']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($a['token'])
            ->getJson($this->itemPath($seededA['storefront']->id, $foreignProduct->id))
            ->assertNotFound();

        $this->assertStringNotContainsString('منتج أجنبي', $res->getContent());
    }

    // ───────────────────────── 4. Same-tenant ineligible product ─────────────────────────

    /** @test */
    public function an_inactive_product_is_excluded_and_returns_404_on_detail(): void
    {
        $auth = $this->registerTenant('prod-inactive', 'owner@prod-inactive.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $inactive = $this->seedProduct($seeded['channel'], ['is_active' => false]);
        app(TenantContext::class)->forget();

        $list = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();
        $this->assertSame([], $list->json('data'));

        $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $inactive->id))
            ->assertNotFound();
    }

    /** @test */
    public function an_unpublished_product_is_excluded_and_returns_404_on_detail(): void
    {
        $auth = $this->registerTenant('prod-unpub', 'owner@prod-unpub.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $unpublished = $this->seedProduct($seeded['channel'], [], published: false);
        app(TenantContext::class)->forget();

        $list = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();
        $this->assertSame([], $list->json('data'));

        $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $unpublished->id))
            ->assertNotFound();
    }

    /** @test */
    public function a_product_published_only_on_a_different_channel_of_the_same_tenant_is_excluded(): void
    {
        $auth = $this->registerTenant('prod-other-channel', 'owner@prod-other-channel.test');
        $seededWeb = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'web-store']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $mobileChannel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        $mobileOnlyProduct = $this->seedProduct($mobileChannel);
        app(TenantContext::class)->forget();

        $list = $this->withToken($auth['token'])
            ->getJson($this->listPath($seededWeb['storefront']->id))
            ->assertOk();
        $this->assertSame([], $list->json('data'));

        $this->withToken($auth['token'])
            ->getJson($this->itemPath($seededWeb['storefront']->id, $mobileOnlyProduct->id))
            ->assertNotFound();
    }

    // ───────────────────────── 5. Cannot inject tenant authority ─────────────────────────

    /** @test */
    public function a_tenant_id_query_or_body_parameter_cannot_widen_the_result(): void
    {
        $a = $this->registerTenant('prod-inject-a', 'owner@prod-inject-a.test');
        $b = $this->registerTenant('prod-inject-b', 'owner@prod-inject-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        app(TenantContext::class)->set($b['tenant_id']);
        $this->seedProduct($seededB['channel'], ['name' => 'منتج ب المحقون']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($a['token'])
            ->getJson($this->listPath($seededA['storefront']->id).'?tenant_id='.$seededB['storefront']->tenant_id.'&company_id='.$b['tenant_id'])
            ->assertOk();

        $this->assertSame([], $res->json('data'));
    }

    // ───────────────────────── 6/7/8. Auth/permission/subscription gates ─────────────────────────

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('prod-guest', 'owner@prod-guest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->getJson($this->listPath($seeded['storefront']->id))->assertUnauthorized();
    }

    /** @test */
    public function self_service_users_are_forbidden(): void
    {
        $auth = $this->registerTenant('prod-ss', 'owner@prod-ss.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@prod-ss.test');

        $this->withToken($token)->getJson($this->listPath($seeded['storefront']->id))->assertForbidden();
    }

    /** @test */
    public function staff_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('prod-staff', 'owner@prod-staff.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@prod-staff.test');

        $this->withToken($token)->getJson($this->listPath($seeded['storefront']->id))->assertForbidden();
    }

    /** @test */
    public function an_inactive_subscription_is_denied(): void
    {
        $auth = $this->registerTenant('prod-expired', 'owner@prod-expired.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        Tenant::query()->where('id', $auth['tenant_id'])->update(['trial_ends_at' => now()->subDay()]);

        $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertStatus(403);
    }

    // ───────────────────────── Payload minimization / safety ─────────────────────────

    /** @test */
    public function list_payload_never_leaks_cost_margin_or_internal_fields(): void
    {
        $auth = $this->registerTenant('prod-safety', 'owner@prod-safety.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->seedProduct($seeded['channel']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();

        $content = $res->getContent();
        foreach (['avg_cost', 'purchase_price', 'internal_notes', 'internal-tag', '9999', '8000', 'quantity_on_hand'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $content);
        }

        $row = $res->json('data.0');
        $this->assertEqualsCanonicalizing(['id', 'name', 'name_en', 'thumbnail_url', 'is_variant_managed'], array_keys($row));
    }

    /** @test */
    public function detail_payload_never_leaks_cost_margin_or_internal_fields(): void
    {
        $auth = $this->registerTenant('prod-safety-detail', 'owner@prod-safety-detail.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedProduct($seeded['channel']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $product->id))
            ->assertOk()
            ->assertJsonPath('data.id', $product->id);

        $content = $res->getContent();
        foreach (['avg_cost', 'purchase_price', 'internal_notes', 'internal-tag', '9999', '8000', 'quantity_on_hand'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $content);
        }
    }

    // ───────────────────────── Search / pagination / ordering ─────────────────────────

    /** @test */
    public function list_supports_search_pagination_and_deterministic_ordering(): void
    {
        $auth = $this->registerTenant('prod-search', 'owner@prod-search.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->seedProduct($seeded['channel'], ['name' => 'زيتون', 'name_en' => 'Olive']);
        $this->seedProduct($seeded['channel'], ['name' => 'أرز', 'name_en' => 'Rice']);
        $this->seedProduct($seeded['channel'], ['name' => 'زبدة', 'name_en' => 'Butter']);
        app(TenantContext::class)->forget();

        $ordered = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();
        $this->assertSame(['أرز', 'زبدة', 'زيتون'], array_column($ordered->json('data'), 'name'));

        $searched = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?search=Olive')
            ->assertOk();
        $this->assertSame(['زيتون'], array_column($searched->json('data'), 'name'));

        $paged = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?per_page=1&page=2')
            ->assertOk();
        $this->assertCount(1, $paged->json('data'));
        $this->assertSame(2, $paged->json('meta.pagination.page'));
        $this->assertSame(3, $paged->json('meta.pagination.total'));
        $this->assertTrue($paged->json('meta.pagination.has_more'));
    }

    // ───────────────────────── Variant-managed product ─────────────────────────

    /** @test */
    public function a_variant_managed_product_is_flagged_in_the_list_and_returns_a_variant_shape_in_detail(): void
    {
        $auth = $this->registerTenant('prod-variant', 'owner@prod-variant.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedProduct($seeded['channel']);
        $product->variant_state = 'variant_managed';
        $product->save();
        app(TenantContext::class)->forget();

        $list = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();
        $this->assertTrue($list->json('data.0.is_variant_managed'));

        $this->withToken($auth['token'])
            ->getJson($this->itemPath($seeded['storefront']->id, $product->id))
            ->assertOk()
            ->assertJsonPath('data.is_variant_managed', true)
            ->assertJsonPath('data.variants', []);
    }

    // ───────────────────────── CUST-H2-4 — category_id filter (feeds the Category-page product grid preview) ─────────────────────────

    /** @test */
    public function category_id_filters_the_list_to_that_categorys_own_eligible_products(): void
    {
        $auth = $this->registerTenant('prod-cat-filter', 'owner@prod-cat-filter.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $category = ProductCategory::create(['name' => 'تصنيف', 'is_active' => true]);
        CommerceCategoryListing::create([
            'tenant_id' => $auth['tenant_id'],
            'category_id' => $category->id,
            'sales_channel_id' => $seeded['channel']->id,
            'is_published' => true,
        ]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($auth['tenant_id']);
        $inCategory = $this->seedProduct($seeded['channel'], ['name' => 'داخل التصنيف', 'category_id' => $category->id]);
        $this->seedProduct($seeded['channel'], ['name' => 'خارج التصنيف']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?category_id='.$category->id)
            ->assertOk();

        $this->assertSame([$inCategory->id], array_column($res->json('data'), 'id'));
    }

    /** @test */
    public function category_id_for_an_unpublished_category_returns_an_empty_list_not_an_error(): void
    {
        $auth = $this->registerTenant('prod-cat-filter-unpub', 'owner@prod-cat-filter-unpub.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $category = ProductCategory::create(['name' => 'تصنيف غير منشور', 'is_active' => true]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->seedProduct($seeded['channel'], ['name' => 'منتج', 'category_id' => $category->id]);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?category_id='.$category->id)
            ->assertOk();

        $this->assertSame([], $res->json('data'));
    }

    // ───────────────────────── CUST-H4-3 — sort=newest (feeds the Home "New Arrivals" Canvas preview) ─────────────────────────

    /** @test */
    public function default_order_is_unchanged_alphabetical_when_sort_is_omitted(): void
    {
        $auth = $this->registerTenant('prod-sort-default', 'owner@prod-sort-default.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->seedProduct($seeded['channel'], ['name' => 'زيتون', 'name_en' => 'Olive']);
        $this->seedProduct($seeded['channel'], ['name' => 'أرز', 'name_en' => 'Rice']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();

        $this->assertSame(['أرز', 'زيتون'], array_column($res->json('data'), 'name'));
    }

    /** @test */
    public function sort_newest_orders_by_most_recently_created_first(): void
    {
        $auth = $this->registerTenant('prod-sort-newest', 'owner@prod-sort-newest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $oldest = $this->seedProduct($seeded['channel'], ['name' => 'زيتون أول']);
        $oldest->forceFill(['created_at' => now()->subDays(3)])->save();
        $middle = $this->seedProduct($seeded['channel'], ['name' => 'أرز وسط']);
        $middle->forceFill(['created_at' => now()->subDay()])->save();
        $newest = $this->seedProduct($seeded['channel'], ['name' => 'موز حديث']);
        $newest->forceFill(['created_at' => now()])->save();
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?sort=newest')
            ->assertOk();

        $this->assertSame(
            [$newest->id, $middle->id, $oldest->id],
            array_column($res->json('data'), 'id'),
        );
    }

    /** @test */
    public function sort_newest_still_respects_tenant_isolation_and_eligibility(): void
    {
        $a = $this->registerTenant('prod-sort-isolation-a', 'owner@prod-sort-isolation-a.test');
        $b = $this->registerTenant('prod-sort-isolation-b', 'owner@prod-sort-isolation-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        app(TenantContext::class)->set($a['tenant_id']);
        $this->seedProduct($seededA['channel'], ['name' => 'منتج أ']);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->seedProduct($seededB['channel'], ['name' => 'منتج ب']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($a['token'])
            ->getJson($this->listPath($seededA['storefront']->id).'?sort=newest')
            ->assertOk();

        $this->assertSame(['منتج أ'], array_column($res->json('data'), 'name'));
    }

    /** @test */
    public function an_unsupported_sort_value_is_rejected(): void
    {
        $auth = $this->registerTenant('prod-sort-invalid', 'owner@prod-sort-invalid.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?sort=price_asc')
            ->assertStatus(422);
    }

    // ───────────────────────── CUST-H4-5 — ids[] batched read (feeds the Home "Featured" Canvas preview + picker's selected chips) ─────────────────────────

    private function idsQuery(array $ids): string
    {
        return collect($ids)->map(fn ($id) => 'ids[]='.$id)->implode('&');
    }

    /** @test */
    public function ids_filter_returns_exactly_the_requested_eligible_products(): void
    {
        $auth = $this->registerTenant('prod-ids-basic', 'owner@prod-ids-basic.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $a = $this->seedProduct($seeded['channel'], ['name' => 'أ']);
        $b = $this->seedProduct($seeded['channel'], ['name' => 'ب']);
        $this->seedProduct($seeded['channel'], ['name' => 'ج']); // not requested
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?'.$this->idsQuery([$a->id, $b->id]))
            ->assertOk();

        $this->assertEqualsCanonicalizing([$a->id, $b->id], array_column($res->json('data'), 'id'));
    }

    /** @test */
    public function ids_filter_still_respects_tenant_isolation(): void
    {
        $a = $this->registerTenant('prod-ids-tenant-a', 'owner@prod-ids-tenant-a.test');
        $b = $this->registerTenant('prod-ids-tenant-b', 'owner@prod-ids-tenant-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        app(TenantContext::class)->set($b['tenant_id']);
        $foreignProduct = $this->seedProduct($seededB['channel'], ['name' => 'منتج أجنبي']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($a['token'])
            ->getJson($this->listPath($seededA['storefront']->id).'?'.$this->idsQuery([$foreignProduct->id]))
            ->assertOk();

        $this->assertSame([], $res->json('data'));
    }

    /** @test */
    public function ids_filter_still_respects_channel_publication_eligibility(): void
    {
        $auth = $this->registerTenant('prod-ids-channel', 'owner@prod-ids-channel.test');
        $seededWeb = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'web-store']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $mobileChannel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        $mobileOnlyProduct = $this->seedProduct($mobileChannel);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seededWeb['storefront']->id).'?'.$this->idsQuery([$mobileOnlyProduct->id]))
            ->assertOk();

        $this->assertSame([], $res->json('data'));
    }

    /** @test */
    public function ids_filter_silently_omits_an_unpublished_or_inactive_id_instead_of_erroring(): void
    {
        $auth = $this->registerTenant('prod-ids-unpub', 'owner@prod-ids-unpub.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $eligible = $this->seedProduct($seeded['channel'], ['name' => 'مؤهَّل']);
        $unpublished = $this->seedProduct($seeded['channel'], ['name' => 'غير منشور'], published: false);
        $inactive = $this->seedProduct($seeded['channel'], ['name' => 'غير نشط']);
        $inactive->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?'.$this->idsQuery([$eligible->id, $unpublished->id, $inactive->id]))
            ->assertOk();

        $this->assertSame([$eligible->id], array_column($res->json('data'), 'id'));
    }

    /** @test */
    public function duplicate_ids_in_the_filter_are_deduplicated_safely(): void
    {
        $auth = $this->registerTenant('prod-ids-dup', 'owner@prod-ids-dup.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedProduct($seeded['channel'], ['name' => 'منتج']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?'.$this->idsQuery([$product->id, $product->id]))
            ->assertOk();

        $this->assertSame([$product->id], array_column($res->json('data'), 'id'));
    }

    /** @test */
    public function a_non_uuid_id_in_the_filter_fails_validation(): void
    {
        $auth = $this->registerTenant('prod-ids-invalid', 'owner@prod-ids-invalid.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?'.$this->idsQuery(['not-a-uuid']))
            ->assertStatus(422);
    }

    /** @test */
    public function more_than_the_max_featured_products_in_the_filter_fails_validation(): void
    {
        $auth = $this->registerTenant('prod-ids-maxout', 'owner@prod-ids-maxout.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $ids = array_map(fn () => (string) Str::uuid(), range(1, 9));

        $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?'.$this->idsQuery($ids))
            ->assertStatus(422);
    }

    /** @test */
    public function exactly_the_max_featured_products_in_the_filter_is_accepted(): void
    {
        $auth = $this->registerTenant('prod-ids-max-ok', 'owner@prod-ids-max-ok.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $products = [];
        for ($i = 0; $i < 8; $i++) {
            $products[] = $this->seedProduct($seeded['channel'], ['name' => "منتج {$i}"]);
        }
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id).'?'.$this->idsQuery(array_map(fn ($p) => $p->id, $products)))
            ->assertOk();

        $this->assertCount(8, $res->json('data'));
    }

    /** @test */
    public function omitting_ids_keeps_the_default_list_behavior_unchanged(): void
    {
        $auth = $this->registerTenant('prod-ids-omitted', 'owner@prod-ids-omitted.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->seedProduct($seeded['channel'], ['name' => 'منتج واحد']);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();

        $this->assertCount(1, $res->json('data'));
    }
}
