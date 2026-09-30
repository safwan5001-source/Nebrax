<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
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
}
