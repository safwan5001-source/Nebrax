<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceProductAddon;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\ProductAddonService;
use App\Services\Commerce\ProductPersonalizationService;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * FLOWERS-H6 / ADR-18 — علاقات الإضافات لكل منتج: الاستبدال الذرّي، التحقق، العزل،
 * RBAC، تنظيف دورة حياة المنتج، والكشف العام بلا تغيير للمنتج العادي.
 *
 * تشغيل: php artisan test --filter=CommerceProductAddonApiTest
 */
class CommerceProductAddonApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function makeProduct(string $tenantId, string $name = 'باقة', int $price = 10000): Product
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create(['name' => $name, 'type' => 'good', 'unit' => 'piece', 'sale_price' => $price, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function url(Product $product): string
    {
        return "/api/commerce/workspace/products/{$product->id}/addons";
    }

    // ── CRUD ────────────────────────────────────────────────────────────

    /** @test */
    public function an_owner_defines_and_reads_addons_in_order(): void
    {
        $auth = $this->registerTenant('ad-def', 'owner@ad-def.test');
        $bouquet = $this->makeProduct($auth['tenant_id']);
        $chocolate = $this->makeProduct($auth['tenant_id'], 'شوكولاتة', 3000);
        $balloon = $this->makeProduct($auth['tenant_id'], 'بالون', 1500);

        $res = $this->withToken($auth['token'])->putJson($this->url($bouquet), ['addons' => [
            ['addon_product_id' => $chocolate->id, 'max_quantity' => 3],
            ['addon_product_id' => $balloon->id],
        ]])->assertOk();

        $this->assertSame([$chocolate->id, $balloon->id], array_column($res->json('data.addons'), 'addon_product_id'));
        $this->assertSame(3, $res->json('data.addons.0.max_quantity'));
        $this->assertSame(1, $res->json('data.addons.1.max_quantity'));
        $this->assertSame('شوكولاتة', $res->json('data.addons.0.name'));
        $this->assertSame($res->json('data.addons'), $this->withToken($auth['token'])->getJson($this->url($bouquet))->assertOk()->json('data.addons'));
    }

    /** @test */
    public function replacing_is_atomic_idempotent_and_removes_what_is_absent(): void
    {
        $auth = $this->registerTenant('ad-rep', 'owner@ad-rep.test');
        $bouquet = $this->makeProduct($auth['tenant_id']);
        $a = $this->makeProduct($auth['tenant_id'], 'أ');
        $b = $this->makeProduct($auth['tenant_id'], 'ب');
        $payload = ['addons' => [['addon_product_id' => $a->id], ['addon_product_id' => $b->id]]];

        $this->withToken($auth['token'])->putJson($this->url($bouquet), $payload)->assertOk();
        $this->withToken($auth['token'])->putJson($this->url($bouquet), $payload)->assertOk();
        $this->assertSame(2, CommerceProductAddon::withoutGlobalScopes()->count());

        $this->withToken($auth['token'])->putJson($this->url($bouquet), ['addons' => [['addon_product_id' => $a->id]]])->assertOk();
        $this->assertSame(1, CommerceProductAddon::withoutGlobalScopes()->count());

        // استبدال مرفوض لا يمسّ الموجود
        $this->withToken($auth['token'])->putJson($this->url($bouquet), ['addons' => [['addon_product_id' => $bouquet->id]]])->assertStatus(422);
        $this->assertSame(1, CommerceProductAddon::withoutGlobalScopes()->count());

        $this->withToken($auth['token'])->putJson($this->url($bouquet), ['addons' => []])->assertOk();
        $this->assertSame(0, CommerceProductAddon::withoutGlobalScopes()->count());
    }

    /** @test */
    public function invalid_relations_are_rejected(): void
    {
        $auth = $this->registerTenant('ad-inv', 'owner@ad-inv.test');
        $bouquet = $this->makeProduct($auth['tenant_id']);
        $a = $this->makeProduct($auth['tenant_id'], 'أ');
        app(TenantContext::class)->set($auth['tenant_id']);
        $inactive = Product::create(['name' => 'موقوف', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 100, 'is_active' => false]);
        app(TenantContext::class)->forget();
        $put = fn (array $addons) => $this->withToken($auth['token'])->putJson($this->url($bouquet), ['addons' => $addons]);

        $put([['addon_product_id' => $bouquet->id]])->assertStatus(422); // نفسه
        $put([['addon_product_id' => $a->id], ['addon_product_id' => $a->id]])->assertStatus(422); // تكرار
        $put([['addon_product_id' => $inactive->id]])->assertStatus(422); // غير نشط
        $put([['addon_product_id' => (string) Str::uuid()]])->assertStatus(422); // غير موجود
        $put([['addon_product_id' => $a->id, 'addon_variant_id' => (string) Str::uuid()]])->assertStatus(422); // متغيّر لمنتج بلا متغيّرات
        $put([['addon_product_id' => $a->id, 'max_quantity' => CommerceProductAddon::MAX_QUANTITY_CEILING + 1]])->assertStatus(422);
        $put([['addon_product_id' => $a->id, 'max_quantity' => 0]])->assertStatus(422);
        $put([['addon_product_id' => 'not-a-uuid']])->assertStatus(422);
        $put(array_map(fn () => ['addon_product_id' => (string) Str::uuid()], range(1, ProductAddonService::MAX_ADDONS + 1)))->assertStatus(422);

        $this->assertSame(0, CommerceProductAddon::withoutGlobalScopes()->count());
    }

    // ── العزل وRBAC ─────────────────────────────────────────────────────

    /** @test */
    public function foreign_tenant_products_are_unreachable_on_either_side(): void
    {
        $a = $this->registerTenant('ad-iso-a', 'owner@ad-iso-a.test');
        $b = $this->registerTenant('ad-iso-b', 'owner@ad-iso-b.test');
        $productA = $this->makeProduct($a['tenant_id']);
        $productB = $this->makeProduct($b['tenant_id']);

        // الأب من مستأجر آخر
        $this->withToken($a['token'])->getJson($this->url($productB))->assertNotFound();
        $this->withToken($a['token'])->putJson($this->url($productB), ['addons' => []])->assertNotFound();
        // الإضافة من مستأجر آخر
        $this->withToken($a['token'])->putJson($this->url($productA), ['addons' => [['addon_product_id' => $productB->id]]])->assertStatus(422);
        $this->assertSame(0, CommerceProductAddon::withoutGlobalScopes()->count());

        app(TenantContext::class)->set($a['tenant_id']);
        try {
            CommerceProductAddon::create(['product_id' => $productA->id, 'addon_product_id' => $productB->id]);
            $this->fail('an add-on from a foreign tenant was accepted');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        try {
            CommerceProductAddon::create(['product_id' => $productA->id, 'addon_product_id' => $productA->id]);
            $this->fail('a self add-on was accepted');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function rbac_staff_reads_but_cannot_write_and_self_service_and_guests_are_denied(): void
    {
        $auth = $this->registerTenant('ad-rbac', 'owner@ad-rbac.test');
        $product = $this->makeProduct($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@ad-rbac.test');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@ad-rbac.test');

        $this->withToken($staff)->getJson($this->url($product))->assertOk();
        $this->withToken($staff)->putJson($this->url($product), ['addons' => []])->assertForbidden();
        $this->withToken($ss)->getJson($this->url($product))->assertForbidden();
        $this->withToken($ss)->putJson($this->url($product), ['addons' => []])->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $this->getJson('/api/commerce/workspace/products/'.Str::uuid().'/addons')->assertUnauthorized();
    }

    // ── دورة الحياة ─────────────────────────────────────────────────────

    /** @test */
    public function relations_never_block_a_true_delete_and_are_cleaned_when_the_product_is_parent_or_addon(): void
    {
        $auth = $this->registerTenant('ad-life', 'owner@ad-life.test');
        $bouquet = $this->makeProduct($auth['tenant_id']);
        $chocolate = $this->makeProduct($auth['tenant_id'], 'شوكولاتة');
        $other = $this->makeProduct($auth['tenant_id'], 'أخرى');
        $this->withToken($auth['token'])->putJson($this->url($bouquet), ['addons' => [['addon_product_id' => $chocolate->id]]])->assertOk();
        $this->withToken($auth['token'])->putJson($this->url($other), ['addons' => [['addon_product_id' => $chocolate->id]]])->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        // حذف المنتج «الإضافة» يزيل كل علاقاته كإضافة
        app(\App\Services\ProductLifecycleService::class)->delete($chocolate, null);
        $this->assertSame(0, CommerceProductAddon::query()->count());

        // حذف المنتج «الأب»
        $x = $this->makeProductInContext('x');
        CommerceProductAddon::create(['product_id' => $bouquet->id, 'addon_product_id' => $x->id]);
        app(\App\Services\ProductLifecycleService::class)->delete($bouquet, null);
        $this->assertSame(0, CommerceProductAddon::query()->count());
        app(TenantContext::class)->forget();
    }

    private function makeProductInContext(string $name): Product
    {
        return Product::create(['name' => $name, 'type' => 'good', 'unit' => 'piece', 'sale_price' => 100, 'is_active' => true]);
    }

    /** @test */
    public function a_product_deleted_after_load_is_not_found_instead_of_a_foreign_key_failure(): void
    {
        $auth = $this->registerTenant('ad-gone', 'owner@ad-gone.test');
        $bouquet = $this->makeProduct($auth['tenant_id']);
        $a = $this->makeProduct($auth['tenant_id'], 'أ');

        app(TenantContext::class)->set($auth['tenant_id']);
        $stale = Product::query()->findOrFail($bouquet->id);
        $bouquet->delete(); // حذف ناعم بعد تحميل الأب

        try {
            app(ProductAddonService::class)->replace($stale, [['addon_product_id' => $a->id]]);
            $this->fail('add-ons were attached to a deleted product');
        } catch (ModelNotFoundException) {
            $this->addToAssertionCount(1);
        }
        $this->assertSame(0, CommerceProductAddon::query()->count());

        // H4: نفس تصليب القفل في خدمة التخصيص
        try {
            app(ProductPersonalizationService::class)->replaceDefinitions($stale, [['key' => 'a', 'type' => 'text', 'label' => 'x']]);
            $this->fail('personalization was defined on a deleted product');
        } catch (ModelNotFoundException) {
            $this->addToAssertionCount(1);
        }
        app(TenantContext::class)->forget();
    }

    // ── الكشف العام ─────────────────────────────────────────────────────

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

    private function publish(Tenant $tenant, SalesChannel $channel, string $name, int $price = 10000, bool $listed = true): Product
    {
        $product = $this->makeProduct($tenant->id, $name, $price);
        if ($listed) {
            app(TenantContext::class)->set($tenant->id);
            CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
            app(TenantContext::class)->forget();
        }

        return $product;
    }

    private function relate(Tenant $tenant, Product $parent, array $addons): void
    {
        app(TenantContext::class)->set($tenant->id);
        app(ProductAddonService::class)->replace($parent, $addons);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_public_detail_exposes_only_sellable_addons_with_server_prices_and_only_when_present(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->publicStore('ad-pub');
        $bouquet = $this->publish($tenant, $channel, 'باقة');
        $plain = $this->publish($tenant, $channel, 'عادي');
        $chocolate = $this->publish($tenant, $channel, 'شوكولاتة', 3000);
        $unpublished = $this->publish($tenant, $channel, 'غير منشور', 500, false);
        $disabled = $this->publish($tenant, $channel, 'معطّل', 700);
        $this->relate($tenant, $bouquet, [
            ['addon_product_id' => $chocolate->id, 'max_quantity' => 2],
            ['addon_product_id' => $unpublished->id],
            ['addon_product_id' => $disabled->id, 'is_active' => false],
        ]);

        $res = $this->getJson("/store/v1/{$tenant->slug}/products/{$bouquet->id}")->assertOk();
        $addons = $res->json('data.addons');
        $this->assertSame([$chocolate->id], array_column($addons, 'product_id'));
        $this->assertSame(3000, $addons[0]['price']['amount_minor']);
        $this->assertSame(2, $addons[0]['max_quantity']);
        $this->assertArrayNotHasKey('tenant_id', $addons[0]);
        $this->assertArrayNotHasKey('cost', $addons[0]);

        $this->assertArrayNotHasKey('addons', $this->getJson("/store/v1/{$tenant->slug}/products/{$plain->id}")->assertOk()->json('data'));
        foreach ($this->getJson("/store/v1/{$tenant->slug}/products")->assertOk()->json('data') as $row) {
            $this->assertArrayNotHasKey('addons', $row);
        }
    }

    /** @test */
    public function another_tenants_addons_never_leak_and_the_mobile_detail_matches(): void
    {
        ['tenant' => $a, 'channel' => $chA] = $this->publicStore('ad-leak-a', SalesChannel::TYPE_MOBILE);
        ['tenant' => $b, 'channel' => $chB] = $this->publicStore('ad-leak-b', SalesChannel::TYPE_MOBILE);
        $pa = $this->publish($a, $chA, 'أ');
        $pb = $this->publish($b, $chB, 'ب');
        $ab = $this->publish($b, $chB, 'إضافة ب');
        $this->relate($b, $pb, [['addon_product_id' => $ab->id]]);

        $service = app(ApiClientKeyService::class);
        $headersA = ['Authorization' => 'Bearer '.$service->issueKey($service->createClient($a, 'mobile-app', true), 'default', [])->plainTextToken];
        $headersB = ['Authorization' => 'Bearer '.$service->issueKey($service->createClient($b, 'mobile-app', true), 'default', [])->plainTextToken];

        $this->assertArrayNotHasKey('addons', $this->getJson("/commerce/v1/products/{$pa->id}", $headersA)->assertOk()->json('data'));
        $this->getJson("/commerce/v1/products/{$pb->id}", $headersA)->assertNotFound();
        $this->assertSame([$ab->id], array_column($this->getJson("/commerce/v1/products/{$pb->id}", $headersB)->assertOk()->json('data.addons'), 'product_id'));
    }
}
