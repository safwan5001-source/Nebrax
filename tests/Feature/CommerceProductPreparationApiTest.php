<?php

namespace Tests\Feature;

use App\Models\CommerceProductPreparation;
use App\Models\Product;
use App\Models\User;
use App\Services\ProductLifecycleService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FLOWERS-H8 / ADR-20 — مهلة تجهيز المنتج: ضبط وقراءة (products.manage / products.view)، التحقق، عزل المستأجر،
 * التنظيف مع الحذف الحقيقي. تشغيل: php artisan test --filter=CommerceProductPreparationApiTest
 */
class CommerceProductPreparationApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function makeProduct(string $tenantId): Product
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create(['name' => 'باقة', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 9000, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function url(Product $product): string
    {
        return "/api/commerce/workspace/products/{$product->id}/preparation";
    }

    /** @test */
    public function an_owner_sets_reads_and_clears_the_preparation_time(): void
    {
        $auth = $this->registerTenant('pp-def', 'owner@pp-def.test');
        $product = $this->makeProduct($auth['tenant_id']);

        $this->withToken($auth['token'])->getJson($this->url($product))->assertOk()->assertExactJson(['data' => ['preparation_minutes' => 0]]);
        $this->withToken($auth['token'])->putJson($this->url($product), ['preparation_minutes' => 180])->assertOk()->assertJsonPath('data.preparation_minutes', 180);
        $this->withToken($auth['token'])->getJson($this->url($product))->assertJsonPath('data.preparation_minutes', 180);
        $this->withToken($auth['token'])->putJson($this->url($product), ['preparation_minutes' => 240])->assertOk();
        $this->assertSame(1, CommerceProductPreparation::withoutGlobalScopes()->count());

        // 0 أو null يمسحان (غياب = لا مهلة) — تمثيل واحد
        $this->withToken($auth['token'])->putJson($this->url($product), ['preparation_minutes' => 0])->assertOk()->assertJsonPath('data.preparation_minutes', 0);
        $this->assertSame(0, CommerceProductPreparation::withoutGlobalScopes()->count());
        $this->withToken($auth['token'])->putJson($this->url($product), ['preparation_minutes' => 60])->assertOk();
        $this->withToken($auth['token'])->putJson($this->url($product), ['preparation_minutes' => null])->assertOk();
        $this->assertSame(0, CommerceProductPreparation::withoutGlobalScopes()->count());
    }

    /** @test */
    public function invalid_values_are_rejected_and_change_nothing(): void
    {
        $auth = $this->registerTenant('pp-val', 'owner@pp-val.test');
        $product = $this->makeProduct($auth['tenant_id']);
        $this->withToken($auth['token'])->putJson($this->url($product), ['preparation_minutes' => 90])->assertOk();

        foreach ([-1, 43201, 'abc', 1.5, [], true] as $bad) {
            $this->withToken($auth['token'])->putJson($this->url($product), ['preparation_minutes' => $bad])->assertStatus(422);
        }
        $this->withToken($auth['token'])->putJson($this->url($product), [])->assertStatus(422);
        $this->withToken($auth['token'])->putJson($this->url($product), ['preparation_minutes' => 43200])->assertOk();
        $this->withToken($auth['token'])->putJson($this->url($product), ['preparation_minutes' => 90])->assertOk();
        $this->assertSame(90, CommerceProductPreparation::withoutGlobalScopes()->value('preparation_minutes'));
    }

    /** @test */
    public function the_endpoint_is_isolated_per_tenant_and_denies_guests_and_self_service(): void
    {
        $a = $this->registerTenant('pp-a', 'owner@pp-a.test');
        $b = $this->registerTenant('pp-b', 'owner@pp-b.test');
        $productA = $this->makeProduct($a['tenant_id']);

        $this->withToken($b['token'])->getJson($this->url($productA))->assertNotFound();
        $this->withToken($b['token'])->putJson($this->url($productA), ['preparation_minutes' => 30])->assertNotFound();
        $this->assertSame(0, CommerceProductPreparation::withoutGlobalScopes()->count());

        app(TenantContext::class)->set($a['tenant_id']);
        User::query()->where('email', 'owner@pp-a.test')->update(['role' => 'self_service']);
        app(TenantContext::class)->forget();
        $this->withToken($a['token'])->putJson($this->url($productA), ['preparation_minutes' => 30])->assertStatus(403);
        $this->withToken($a['token'])->getJson($this->url($productA))->assertStatus(403);
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $this->getJson('/api/commerce/workspace/products/'.\Illuminate\Support\Str::uuid().'/preparation')->assertUnauthorized();
        $this->putJson('/api/commerce/workspace/products/'.\Illuminate\Support\Str::uuid().'/preparation', ['preparation_minutes' => 5])->assertUnauthorized();
    }

    /** @test */
    public function the_model_rejects_a_foreign_tenant_product_and_the_row_is_cleaned_with_a_true_delete(): void
    {
        $a = $this->registerTenant('pp-own-a', 'owner@pp-own-a.test');
        $b = $this->registerTenant('pp-own-b', 'owner@pp-own-b.test');
        $productA = $this->makeProduct($a['tenant_id']);

        app(TenantContext::class)->set($b['tenant_id']);
        try {
            CommerceProductPreparation::create(['product_id' => $productA->id, 'preparation_minutes' => 30]);
            $this->fail('a foreign-tenant product was accepted');
        } catch (\RuntimeException) {
            $this->assertSame(0, CommerceProductPreparation::withoutGlobalScopes()->count());
        }
        app(TenantContext::class)->forget();

        $this->withToken($a['token'])->putJson($this->url($productA), ['preparation_minutes' => 30])->assertOk();
        app(TenantContext::class)->set($a['tenant_id']);
        app(ProductLifecycleService::class)->delete($productA, null);
        $this->assertSame(0, CommerceProductPreparation::query()->count());
        app(TenantContext::class)->forget();
    }
}
