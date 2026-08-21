<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductActivity;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProductLifecycleTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function payload(array $overrides = []): array
    {
        return [
            'name'       => 'صنف دورة الحياة',
            'sku'        => 'LIFE-1001',
            'type'       => 'good',
            'sale_price' => 12000,
            'track_inventory' => false,
            ...$overrides,
        ];
    }

    /** @test */
    public function creating_a_product_records_an_append_only_activity_with_the_actor(): void
    {
        $auth = $this->registerTenant();
        $product = $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload())
            ->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->getJson("/api/products/{$product['id']}/activity")
            ->assertOk()
            ->assertJsonPath('data.0.action', 'created')
            ->assertJsonPath('data.0.user.name', 'المالك')
            ->assertJsonPath('data.0.diff.name.0', null)
            ->assertJsonPath('data.0.diff.name.1', 'صنف دورة الحياة');
    }

    /** @test */
    public function deactivating_a_product_is_logged_but_does_not_delete_its_catalog_record(): void
    {
        $auth = $this->registerTenant();
        $product = $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload())
            ->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->putJson("/api/products/{$product['id']}", $this->payload([
                'name' => 'صنف موقوف',
                'is_active' => false,
            ]))
            ->assertOk()
            ->assertJsonPath('data.is_active', false);

        $this->assertFalse(Product::findOrFail($product['id'])->is_active);
        $event = ProductActivity::where('product_id', $product['id'])->latest('created_at')->firstOrFail();
        $this->assertSame('status_changed', $event->action);
        $this->assertSame([true, false], $event->diff['is_active']);
    }

    /** @test */
    public function a_product_with_inventory_history_cannot_be_deleted_or_reclassified(): void
    {
        $auth = $this->registerTenant();
        $product = $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload([
                'track_inventory' => true,
                'purchase_price' => 4500,
                'initial_quantity' => 2,
            ]))
            ->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->deleteJson("/api/products/{$product['id']}")
            ->assertStatus(422)
            ->assertJsonPath('message', 'لا يمكن حذف المنتج لأنه مرتبط بـ 2 سجلّاً. عطّله بدلاً من ذلك حفاظاً على حركاته ومستنداته.');

        $this->withToken($auth['token'])
            ->putJson("/api/products/{$product['id']}", $this->payload([
                'type' => 'service',
                'track_inventory' => false,
            ]))
            ->assertStatus(422)
            ->assertJsonPath('message', 'لا يمكن تغيير نوع المنتج أو تتبع مخزونه بعد وجود حركة أو رصيد مخزني. أنشئ منتجاً جديداً بدلاً من إعادة تفسير السجل التاريخي.');

        $this->assertNotNull(Product::find($product['id']));
    }

    /** @test */
    public function an_unused_product_can_still_be_soft_deleted_and_releases_its_sku(): void
    {
        $auth = $this->registerTenant();
        $product = $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload())
            ->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->deleteJson("/api/products/{$product['id']}")
            ->assertOk();

        $this->assertSoftDeleted('products', ['id' => $product['id']]);
        $this->assertDatabaseHas('product_activities', [
            'product_id' => $product['id'],
            'action' => 'deleted',
        ]);
        $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload(['name' => 'صنف بديل']))
            ->assertCreated();
    }

    /** @test */
    public function tenant_cannot_read_another_tenants_product_activity(): void
    {
        $first = $this->registerTenant('lifecycle-one', 'owner@lifecycle-one.test');
        $second = $this->registerTenant('lifecycle-two', 'owner@lifecycle-two.test');
        $product = $this->withToken($first['token'])
            ->postJson('/api/products', $this->payload())
            ->assertCreated()['data'];

        $this->withToken($second['token'])
            ->getJson("/api/products/{$product['id']}/activity")
            ->assertNotFound();
    }
}
