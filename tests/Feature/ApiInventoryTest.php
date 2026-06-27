<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\StockMovement;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات تقرير المخزون (GET /api/inventory). قراءة فقط — لا قيود تُولَّد.
 * تشغيل: php artisan test --filter=ApiInventoryTest
 */
class ApiInventoryTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_lists_only_tracked_products_with_computed_value(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);

        Product::create([
            'tenant_id' => $tid, 'name' => 'جهاز قياس', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 50000, // 500.00 للوحدة
        ]);
        Product::create([
            'tenant_id' => $tid, 'name' => 'خدمة استشارية', 'type' => 'service', 'track_inventory' => false,
        ]);

        $this->withToken($token)->getJson('/api/inventory')
            ->assertOk()
            ->assertJsonCount(1, 'data') // الخدمة غير المتتبَّعة لا تظهر
            ->assertJsonPath('data.0.quantity_on_hand', 10)
            ->assertJsonPath('data.0.avg_cost', '500.00')
            ->assertJsonPath('data.0.stock_value', '5000.00')
            ->assertJsonPath('total_value', '5000.00');
    }

    /** @test */
    public function it_lists_movements_for_a_product(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);

        $product = Product::create([
            'tenant_id' => $tid, 'name' => 'جهاز', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 5, 'avg_cost' => 20000,
        ]);
        StockMovement::create([
            'tenant_id' => $tid, 'product_id' => $product->id, 'type' => 'in',
            'quantity' => 5, 'unit_cost' => 20000, 'total_cost' => 100000,
            'balance_quantity' => 5, 'movement_date' => '2026-06-01',
        ]);

        $this->withToken($token)->getJson("/api/inventory/{$product->id}/movements")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', 'in')
            ->assertJsonPath('data.0.total_cost', '1000.00')
            ->assertJsonPath('data.0.balance_quantity', 5);
    }

    /** @test */
    public function inventory_is_tenant_isolated(): void
    {
        ['token' => $aToken] = $this->registerTenant('acme', 'owner@acme.test');
        ['tenant_id' => $bId] = $this->registerTenant('globex', 'owner@globex.test');

        app(TenantContext::class)->set($bId);
        Product::create([
            'tenant_id' => $bId, 'name' => 'صنف غلوبكس', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 3, 'avg_cost' => 10000,
        ]);

        // المستأجر A لا يرى مخزون B
        $this->withToken($aToken)->getJson('/api/inventory')
            ->assertOk()->assertJsonCount(0, 'data')->assertJsonPath('total_value', '0.00');
    }
}
