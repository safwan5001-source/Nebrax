<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommerceProductPublicationApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedProductAndStore(string $tenantId, string $suffix): array
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create([
            'name' => 'منتج '.$suffix,
            'sku' => 'COM-'.$suffix,
            'type' => 'good',
            'unit' => 'piece',
            'sale_price' => 10000,
            'purchase_price' => 5000,
            'tax_rate' => 15,
            'is_active' => true,
        ]);
        $channel = SalesChannel::create([
            'slug' => 'web-'.$suffix,
            'name' => 'ويب '.$suffix,
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'store-'.$suffix,
            'name' => 'متجر '.$suffix,
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return compact('product', 'channel', 'storefront');
    }

    /**
     * Tests run several HTTP requests inside one application process, unlike production.
     * Clear the mutable TenantContext before each request so SetTenant must derive it again
     * from the authenticated principal instead of inheriting setup/previous-request state.
     */
    private function forgetTenantContext(): void
    {
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function owner_can_publish_and_unpublish_a_product_in_its_web_store(): void
    {
        $auth = $this->registerTenant('pub-a', 'pub-a@example.test');
        $scene = $this->seedProductAndStore($auth['tenant_id'], 'a');
        $path = '/api/commerce/workspace/products/'.$scene['product']->id.'/publication';

        $this->forgetTenantContext();
        $this->withToken($auth['token'])->getJson($path)
            ->assertOk()
            ->assertJsonPath('data.stores.0.id', $scene['storefront']->id)
            ->assertJsonPath('data.stores.0.is_published', false);

        $this->forgetTenantContext();
        $this->withToken($auth['token'])->putJson($path, [
            'storefront_ids' => [$scene['storefront']->id],
        ])->assertOk()->assertJsonPath('data.stores.0.is_published', true);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(CommerceListing::query()
            ->where('product_id', $scene['product']->id)
            ->where('sales_channel_id', $scene['channel']->id)
            ->where('is_published', true)->exists());
        app(TenantContext::class)->forget();

        $this->forgetTenantContext();
        $this->withToken($auth['token'])->putJson($path, ['storefront_ids' => []])
            ->assertOk()->assertJsonPath('data.stores.0.is_published', false);
    }

    /** @test */
    public function tenant_a_cannot_publish_its_product_to_tenant_b_store(): void
    {
        $a = $this->registerTenant('pub-a2', 'pub-a2@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('pub-b2', 'pub-b2@example.test');
        $sceneA = $this->seedProductAndStore($a['tenant_id'], 'a2');
        $sceneB = $this->seedProductAndStore($b['tenant_id'], 'b2');

        $this->forgetTenantContext();
        $this->withToken($a['token'])->putJson(
            '/api/commerce/workspace/products/'.$sceneA['product']->id.'/publication',
            ['storefront_ids' => [$sceneB['storefront']->id]],
        )->assertUnprocessable();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertFalse(CommerceListing::query()
            ->where('product_id', $sceneA['product']->id)
            ->where('sales_channel_id', $sceneB['channel']->id)->exists());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function tenant_a_cannot_read_or_mutate_tenant_b_product_publication(): void
    {
        $a = $this->registerTenant('pub-a3', 'pub-a3@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('pub-b3', 'pub-b3@example.test');
        $this->seedProductAndStore($a['tenant_id'], 'a3');
        $sceneB = $this->seedProductAndStore($b['tenant_id'], 'b3');
        $path = '/api/commerce/workspace/products/'.$sceneB['product']->id.'/publication';

        $this->forgetTenantContext();
        $this->withToken($a['token'])->getJson($path)->assertNotFound();
        $this->forgetTenantContext();
        $this->withToken($a['token'])->putJson($path, ['storefront_ids' => []])->assertNotFound();
    }

    /** @test */
    public function inactive_store_or_channel_is_not_publishable(): void
    {
        $auth = $this->registerTenant('pub-inactive', 'pub-inactive@example.test');
        $scene = $this->seedProductAndStore($auth['tenant_id'], 'inactive');
        app(TenantContext::class)->set($auth['tenant_id']);
        $scene['storefront']->forceFill(['is_active' => false])->save();
        app(TenantContext::class)->forget();

        $path = '/api/commerce/workspace/products/'.$scene['product']->id.'/publication';
        $this->forgetTenantContext();
        $this->withToken($auth['token'])->getJson($path)
            ->assertOk()->assertJsonPath('data.stores', []);
        $this->forgetTenantContext();
        $this->withToken($auth['token'])->putJson($path, [
            'storefront_ids' => [$scene['storefront']->id],
        ])->assertUnprocessable();
    }
}
