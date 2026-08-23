<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Warehouse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * المخازن: الكميات تُفصَّل لكل مخزن، بينما **التقييم يبقى عالمياً** على المنتج
 * (متوسط متحرك واحد) — فلا يتغيّر قيد تكلفة البضاعة المباعة ولا رصيد 1140.
 * تشغيل: php artisan test --filter=WarehouseTest
 */
class WarehouseTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function trackedProduct(string $token): string
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'بضاعة', 'type' => 'good', 'sale_price' => 20000, 'purchase_price' => 10000,
            'track_inventory' => true,
        ])->assertCreated()['data']['id'];
    }

    /** يشتري كمية بمخزن محدَّد (ترويسة الفرع لا تلزم — المخزن صريح). */
    private function purchase(string $token, string $productId, int $qty, int $unitCost): void
    {
        $supplier = $this->withToken($token)->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])['data']['id'];
        $id = $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplier, 'payment_type' => 'credit',
            'items' => [['product_id' => $productId, 'quantity' => $qty, 'unit_price' => $unitCost, 'tax_rate' => 15]],
        ])['data']['id'];
        $this->withToken($token)->postJson("/api/purchases/{$id}/post")->assertOk();
    }

    /** @test */
    public function registration_creates_a_default_main_warehouse(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->getJson('/api/warehouses')->assertOk();
        $this->assertCount(1, $res['data']);
        $this->assertSame('المخزن الرئيسي', $res['data'][0]['name']);
        $this->assertTrue($res['data'][0]['is_default']);
    }

    /** @test */
    public function it_creates_a_warehouse_linked_to_a_branch_with_auto_code(): void
    {
        $auth = $this->registerTenant();
        $branch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])['data']['id'];

        $res = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن الخبر', 'branch_id' => $branch, 'city' => 'الخبر',
        ])->assertCreated();

        $this->assertSame('00002', $res['data']['code']); // بعد المخزن الرئيسي
        $this->assertSame($branch, $res['data']['branch_id']);
        $this->assertFalse($res['data']['is_default']); // الافتراضي يبقى الأول
    }

    /** @test */
    public function it_previews_the_next_warehouse_code_without_allocating_it(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->getJson('/api/warehouses/next-code')
            ->assertOk()
            ->assertJsonPath('data.code', '00002');

        $this->withToken($auth['token'])->postJson('/api/warehouses', ['name' => 'مخزن الخبر'])
            ->assertCreated()
            ->assertJsonPath('data.code', '00002');

        $this->withToken($auth['token'])->getJson('/api/warehouses/next-code')
            ->assertOk()
            ->assertJsonPath('data.code', '00003');
    }

    /** @test */
    public function purchasing_increases_the_warehouse_quantity_and_keeps_valuation_global(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->trackedProduct($auth['token']);

        $this->purchase($auth['token'], $product, 10, 4000); // 10 وحدات بتكلفة 40.00

        $main = Warehouse::where('is_default', true)->firstOrFail();

        // الكمية تُفصَّل في المخزن الافتراضي
        $row = ProductWarehouseStock::where('product_id', $product)->where('warehouse_id', $main->id)->first();
        $this->assertNotNull($row);
        $this->assertSame(10, $row->quantity);

        // والإجمالي على المنتج يبقى المرجع، والتقييم عالمي كما هو
        $p = Product::find($product);
        $this->assertSame(10, $p->quantity_on_hand);
        $this->assertSame(4000, $p->avg_cost);

        // ورصيد المخزون 1140 = 40,000 (لا يتأثّر بتفصيل المخازن)
        $this->assertEquals(40000, Account::where('code', '1140')->first()->balance->balance);
    }

    /** @test */
    public function the_sum_of_warehouse_quantities_equals_the_product_total(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->trackedProduct($auth['token']);

        $this->purchase($auth['token'], $product, 10, 4000);
        $this->purchase($auth['token'], $product, 5, 4000);

        $sum = (int) ProductWarehouseStock::where('product_id', $product)->sum('quantity');
        $this->assertSame(15, $sum);
        $this->assertSame(15, Product::find($product)->quantity_on_hand);
    }

    /** @test */
    public function selling_reduces_the_warehouse_quantity_and_cogs_is_unchanged(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->trackedProduct($auth['token']);
        $this->purchase($auth['token'], $product, 10, 4000);

        $customer = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        $inv = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $customer, 'payment_type' => 'cash',
            'items' => [['product_id' => $product, 'quantity' => 4, 'unit_price' => 20000, 'tax_rate' => 15]],
        ])['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/invoices/{$inv}/post")->assertOk();

        $main = Warehouse::where('is_default', true)->firstOrFail();
        $this->assertSame(6, ProductWarehouseStock::where('product_id', $product)->where('warehouse_id', $main->id)->first()->quantity);
        $this->assertSame(6, Product::find($product)->quantity_on_hand);

        // تكلفة البضاعة المباعة كما هي: 4 × 40.00 = 160.00 (مدين 5110)
        $this->assertEquals(16000, Account::where('code', '5110')->first()->balance->balance);
        // والمخزون 1140 = 40,000 − 16,000
        $this->assertEquals(24000, Account::where('code', '1140')->first()->balance->balance);
    }

    /** @test */
    public function a_warehouse_holding_stock_cannot_be_deleted(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->trackedProduct($auth['token']);
        $this->purchase($auth['token'], $product, 3, 4000);

        $main = Warehouse::where('is_default', true)->firstOrFail();
        $this->withToken($auth['token'])->deleteJson("/api/warehouses/{$main->id}")->assertStatus(422);
    }

    /** @test */
    public function warehouse_stock_endpoint_lists_quantities(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->trackedProduct($auth['token']);
        $this->purchase($auth['token'], $product, 7, 4000);

        $main = Warehouse::where('is_default', true)->firstOrFail();
        $this->withToken($auth['token'])->getJson("/api/warehouses/{$main->id}/stock")
            ->assertOk()
            ->assertJsonPath('data.0.quantity', 7);
    }

    /** @test */
    public function warehouses_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($a['token'])->postJson('/api/warehouses', ['name' => 'مخزن آكمي'])->assertCreated();

        $b = $this->registerTenant('globex', 'owner@globex.test');
        // كلٌّ يرى مخزنه الرئيسي فقط
        $this->withToken($b['token'])->getJson('/api/warehouses')->assertOk()->assertJsonCount(1, 'data');
    }
}
