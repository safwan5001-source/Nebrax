<?php

namespace Tests\Feature;

use App\Models\ApiClient;
use App\Models\CommerceListing;
use App\Models\CommerceProductPersonalizationField;
use App\Models\CommerceProductPersonalizationOption;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\ProductPersonalizationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * FLOWERS-H4a / ADR-16 — تعريفات التخصيص لكل منتج: الاستبدال الذرّي، التحقق،
 * العزل، RBAC، والكشف العام (store/v1 + commerce/v1) بلا تغيير للمنتج العادي.
 *
 * تشغيل: php artisan test --filter=CommerceProductPersonalizationApiTest
 */
class CommerceProductPersonalizationApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function makeProduct(string $tenantId, string $name = 'كيكة'): Product
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create(['name' => $name, 'type' => 'good', 'unit' => 'piece', 'sale_price' => 10000, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function url(Product $product): string
    {
        return "/api/commerce/workspace/products/{$product->id}/personalization";
    }

    private function cakeFields(): array
    {
        return [
            ['key' => 'cake-text', 'type' => 'text', 'label' => 'الكتابة على الكيكة', 'label_en' => 'Cake text', 'is_required' => true, 'max_length' => 20],
            ['key' => 'card', 'type' => 'textarea', 'label' => 'نص البطاقة', 'help_text' => 'اختياري'],
            ['key' => 'flavor', 'type' => 'select', 'label' => 'النكهة', 'options' => [
                ['value_key' => 'vanilla', 'label' => 'فانيلا', 'label_en' => 'Vanilla'],
                ['value_key' => 'chocolate', 'label' => 'شوكولاتة'],
            ]],
        ];
    }

    /** @test */
    public function an_owner_defines_and_reads_personalization_fields_in_order(): void
    {
        $auth = $this->registerTenant('pz-def', 'owner@pz-def.test');
        $product = $this->makeProduct($auth['tenant_id']);

        $res = $this->withToken($auth['token'])->putJson($this->url($product), ['fields' => $this->cakeFields()])->assertOk();

        $this->assertSame(['cake-text', 'card', 'flavor'], array_column($res->json('data.fields'), 'key'));
        $this->assertSame(20, $res->json('data.fields.0.max_length'));
        $this->assertSame(250, $res->json('data.fields.1.max_length')); // الافتراضي للنص الطويل
        $this->assertNull($res->json('data.fields.2.max_length'));
        $this->assertSame(['vanilla', 'chocolate'], array_column($res->json('data.fields.2.options'), 'value_key'));

        $this->assertSame($res->json('data.fields'), $this->withToken($auth['token'])->getJson($this->url($product))->assertOk()->json('data.fields'));
    }

    /** @test */
    public function personalization_definitions_never_block_a_true_product_delete_and_are_cleaned_with_it(): void
    {
        $auth = $this->registerTenant('pz-life', 'owner@pz-life.test');
        $product = $this->makeProduct($auth['tenant_id']);
        $this->withToken($auth['token'])->putJson($this->url($product), ['fields' => $this->cakeFields()])->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        app(\App\Services\ProductLifecycleService::class)->delete($product, null);

        $this->assertSame(0, CommerceProductPersonalizationField::query()->count());
        $this->assertSame(0, CommerceProductPersonalizationOption::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function replacing_is_atomic_idempotent_and_removes_what_is_absent(): void
    {
        $auth = $this->registerTenant('pz-replace', 'owner@pz-replace.test');
        $product = $this->makeProduct($auth['tenant_id']);

        $this->withToken($auth['token'])->putJson($this->url($product), ['fields' => $this->cakeFields()])->assertOk();
        $this->withToken($auth['token'])->putJson($this->url($product), ['fields' => $this->cakeFields()])->assertOk();
        $this->assertSame(3, CommerceProductPersonalizationField::withoutGlobalScopes()->count());
        $this->assertSame(2, CommerceProductPersonalizationOption::withoutGlobalScopes()->count());

        $this->withToken($auth['token'])->putJson($this->url($product), ['fields' => [$this->cakeFields()[0]]])->assertOk();
        $this->assertSame(1, CommerceProductPersonalizationField::withoutGlobalScopes()->count());
        $this->assertSame(0, CommerceProductPersonalizationOption::withoutGlobalScopes()->count());

        // استبدال مرفوض لا يمسّ الموجود
        $this->withToken($auth['token'])->putJson($this->url($product), ['fields' => [['key' => 'a', 'type' => 'select', 'label' => 'x']]])->assertStatus(422);
        $this->assertSame(1, CommerceProductPersonalizationField::withoutGlobalScopes()->count());
    }

    /** @test */
    public function invalid_definitions_are_rejected(): void
    {
        $auth = $this->registerTenant('pz-invalid', 'owner@pz-invalid.test');
        $product = $this->makeProduct($auth['tenant_id']);
        $put = fn (array $fields) => $this->withToken($auth['token'])->putJson($this->url($product), ['fields' => $fields]);

        $put([['key' => 'Bad Key', 'type' => 'text', 'label' => 'x']])->assertStatus(422);
        $put([['key' => 'a', 'type' => 'image', 'label' => 'x']])->assertStatus(422); // محجوز لـH4c
        $put([['key' => 'a', 'type' => 'text', 'label' => '  ']])->assertStatus(422);
        $put([['key' => 'a', 'type' => 'text', 'label' => 'x', 'max_length' => 501]])->assertStatus(422);
        $put([['key' => 'a', 'type' => 'text', 'label' => 'x'], ['key' => 'a', 'type' => 'text', 'label' => 'y']])->assertStatus(422);
        $put([['key' => 'a', 'type' => 'text', 'label' => 'x', 'options' => [['value_key' => 'v', 'label' => 'V']]]])->assertStatus(422);
        $put([['key' => 'a', 'type' => 'select', 'label' => 'x', 'options' => [['value_key' => 'v', 'label' => 'V'], ['value_key' => 'v', 'label' => 'W']]]])->assertStatus(422);
        $put(array_map(fn ($i) => ['key' => "f{$i}", 'type' => 'text', 'label' => 'x'], range(1, ProductPersonalizationService::MAX_FIELDS + 1)))->assertStatus(422);

        $this->assertSame(0, CommerceProductPersonalizationField::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_foreign_tenant_product_is_unreachable_and_models_guard_structurally(): void
    {
        $a = $this->registerTenant('pz-iso-a', 'owner@pz-iso-a.test');
        $b = $this->registerTenant('pz-iso-b', 'owner@pz-iso-b.test');
        $productB = $this->makeProduct($b['tenant_id']);

        $this->withToken($a['token'])->getJson($this->url($productB))->assertNotFound();
        $this->withToken($a['token'])->putJson($this->url($productB), ['fields' => $this->cakeFields()])->assertNotFound();
        $this->assertSame(0, CommerceProductPersonalizationField::withoutGlobalScopes()->count());

        app(TenantContext::class)->set($a['tenant_id']);
        try {
            CommerceProductPersonalizationField::create(['product_id' => $productB->id, 'key' => 'x', 'type' => 'text', 'label' => 'x']);
            $this->fail('a field on a foreign product was accepted');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        try {
            CommerceProductPersonalizationField::create(['product_id' => $this->makeProduct($a['tenant_id'])->id, 'key' => 'x', 'type' => 'image', 'label' => 'x']);
            $this->fail('the reserved image type was accepted');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
    }

    /** @test */
    public function rbac_staff_reads_but_cannot_write_and_self_service_and_guests_are_denied(): void
    {
        $auth = $this->registerTenant('pz-rbac', 'owner@pz-rbac.test');
        $product = $this->makeProduct($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@pz-rbac.test');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@pz-rbac.test');

        $this->withToken($staff)->getJson($this->url($product))->assertOk();
        $this->withToken($staff)->putJson($this->url($product), ['fields' => []])->assertForbidden();
        $this->withToken($ss)->getJson($this->url($product))->assertForbidden();
        $this->withToken($ss)->putJson($this->url($product), ['fields' => []])->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $this->getJson('/api/commerce/workspace/products/'.Str::uuid().'/personalization')->assertUnauthorized();
    }

    // ── القراءة العامة ─────────────────────────────────────────────────

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

    private function publish(Tenant $tenant, SalesChannel $channel, string $name): Product
    {
        $product = $this->makeProduct($tenant->id, $name);
        app(TenantContext::class)->set($tenant->id);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function define(Tenant $tenant, Product $product, array $fields): void
    {
        app(TenantContext::class)->set($tenant->id);
        app(ProductPersonalizationService::class)->replaceDefinitions($product, $fields);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_public_detail_exposes_only_active_fields_and_only_when_present(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->publicStore('pz-pub');
        $cake = $this->publish($tenant, $channel, 'كيكة مخصصة');
        $plain = $this->publish($tenant, $channel, 'منتج عادي');
        $fields = $this->cakeFields();
        $fields[1]['is_active'] = false; // card معطَّل
        $fields[2]['options'][1]['is_active'] = false; // chocolate معطَّل
        $this->define($tenant, $cake, $fields);

        $res = $this->getJson("/store/v1/{$tenant->slug}/products/{$cake->id}")->assertOk();
        $this->assertSame(['cake-text', 'flavor'], array_column($res->json('data.personalization.fields'), 'key'));
        $flavor = $res->json('data.personalization.fields.1');
        $this->assertSame(['vanilla'], array_column($flavor['options'], 'value_key'));
        $this->assertArrayNotHasKey('is_active', $flavor);
        $this->assertArrayNotHasKey('tenant_id', $res->json('data.personalization.fields.0'));

        // منتج بلا تعريفات: المفتاح غائب كلياً (شكل المتاجر العامة بلا تغيير)
        $this->assertArrayNotHasKey('personalization', $this->getJson("/store/v1/{$tenant->slug}/products/{$plain->id}")->assertOk()->json('data'));
        // القائمة لا تحمله أبداً
        $list = $this->getJson("/store/v1/{$tenant->slug}/products")->assertOk()->json('data');
        foreach ($list as $row) {
            $this->assertArrayNotHasKey('personalization', $row);
        }
    }

    /** @test */
    public function another_tenants_definitions_never_leak_into_a_storefront(): void
    {
        ['tenant' => $a, 'channel' => $chA] = $this->publicStore('pz-leak-a');
        ['tenant' => $b, 'channel' => $chB] = $this->publicStore('pz-leak-b');
        $pa = $this->publish($a, $chA, 'منتج أ');
        $pb = $this->publish($b, $chB, 'منتج ب');
        $this->define($b, $pb, $this->cakeFields());

        $this->assertArrayNotHasKey('personalization', $this->getJson("/store/v1/{$a->slug}/products/{$pa->id}")->assertOk()->json('data'));
        $this->getJson("/store/v1/{$a->slug}/products/{$pb->id}")->assertNotFound();
    }

    /** @test */
    public function the_mobile_detail_exposes_the_same_fields(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->publicStore('pz-mob', SalesChannel::TYPE_MOBILE);
        $cake = $this->publish($tenant, $channel, 'كيكة');
        $this->define($tenant, $cake, $this->cakeFields());

        $service = app(ApiClientKeyService::class);
        $client = $service->createClient($tenant, 'mobile-app', true);
        $headers = ['Authorization' => 'Bearer '.$service->issueKey($client, 'default', [])->plainTextToken];

        $res = $this->getJson("/commerce/v1/products/{$cake->id}", $headers)->assertOk();
        $this->assertSame(['cake-text', 'card', 'flavor'], array_column($res->json('data.personalization.fields'), 'key'));
        $this->assertTrue($res->json('data.personalization.fields.0.is_required'));
    }
}
