<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\Warehouse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * المستندات الواعية بالمخزن:
 *
 * التقييم المالي ومتوسط التكلفة يبقيان على مستوى المنتج، لكن كل مستند يغيّر
 * الكمية يثبت مخزنه. هذه الاختبارات تحرس من عودة الاستلام أو البيع أو الرد
 * إلى المخزن الافتراضي حين يختار المستخدم موقعاً آخر.
 */
class WarehouseAwareDocumentsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function tenant(): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        return $auth;
    }

    private function product(string $token, string $name = 'مضخة'): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => $name,
            'sku' => 'SKU-'.uniqid(),
            'type' => 'good',
            'sale_price' => 2000,
            'purchase_price' => 1000,
            'track_inventory' => true,
        ])->assertCreated()['data'];
    }

    private function warehouse(string $token, string $name): array
    {
        return $this->withToken($token)->postJson('/api/warehouses', [
            'name' => $name,
        ])->assertCreated()['data'];
    }

    private function supplier(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'مورد الاختبار '.uniqid(),
            'type' => 'supplier',
        ])->assertCreated()['data']['id'];
    }

    private function customer(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل الاختبار '.uniqid(),
            'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /** @return array{id: string, line_id: string} */
    private function buy(string $token, string $supplierId, string $productId, string $warehouseId, int $quantity = 10): array
    {
        $purchase = $this->withToken($token)->postJson('/api/purchases', [
            'partner_id' => $supplierId,
            'warehouse_id' => $warehouseId,
            'payment_type' => 'credit',
            'items' => [[
                'product_id' => $productId,
                'quantity' => $quantity,
                'unit_price' => 1000,
                'tax_rate' => 0,
            ]],
        ])->assertCreated()['data'];

        $this->withToken($token)->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();
        $stored = Purchase::with('lines')->findOrFail($purchase['id']);

        return ['id' => $stored->id, 'line_id' => $stored->lines->firstOrFail()->id];
    }

    /** @test */
    public function purchase_receipt_uses_the_explicit_warehouse_not_the_default(): void
    {
        $auth = $this->tenant();
        $token = $auth['token'];
        $product = $this->product($token);
        $target = $this->warehouse($token, 'مخزن الاستلام');

        $purchase = $this->buy($token, $this->supplier($token), $product['id'], $target['id']);

        $this->assertSame($target['id'], Purchase::findOrFail($purchase['id'])->warehouse_id);
        $this->assertSame(10, (int) ProductWarehouseStock::where('product_id', $product['id'])
            ->where('warehouse_id', $target['id'])->value('quantity'));

        $default = Warehouse::where('is_default', true)->firstOrFail();
        $this->assertNull(ProductWarehouseStock::where('product_id', $product['id'])
            ->where('warehouse_id', $default->id)->first());
    }

    /** @test */
    public function sales_issue_checks_the_selected_warehouse_not_the_company_total(): void
    {
        $auth = $this->tenant();
        $token = $auth['token'];
        $product = $this->product($token);
        $stocked = $this->warehouse($token, 'مخزن الرياض');
        $this->buy($token, $this->supplier($token), $product['id'], $stocked['id']);
        $customer = $this->customer($token);

        $sold = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customer,
            'warehouse_id' => $stocked['id'],
            'payment_type' => 'cash',
            'items' => [[
                'product_id' => $product['id'], 'quantity' => 4, 'unit_price' => 2000, 'tax_rate' => 0,
            ]],
        ])->assertCreated()['data'];
        $this->withToken($token)->postJson("/api/invoices/{$sold['id']}/post")->assertOk();

        $this->assertSame(6, (int) ProductWarehouseStock::where('product_id', $product['id'])
            ->where('warehouse_id', $stocked['id'])->value('quantity'));

        $default = Warehouse::where('is_default', true)->firstOrFail();
        $wrongWarehouseInvoice = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customer,
            'warehouse_id' => $default->id,
            'payment_type' => 'cash',
            'items' => [[
                'product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 2000, 'tax_rate' => 0,
            ]],
        ])->assertCreated()['data'];

        // إجمالي المنتج 6، لكنه صفر في المخزن الافتراضي: لا يسمح بالخروج منه.
        $this->withToken($token)->postJson("/api/invoices/{$wrongWarehouseInvoice['id']}/post")
            ->assertStatus(422);
        $this->assertSame(6, Product::findOrFail($product['id'])->quantity_on_hand);
    }

    /** @test */
    public function purchase_return_inherits_the_source_purchase_warehouse_when_none_is_sent(): void
    {
        $auth = $this->tenant();
        $token = $auth['token'];
        $product = $this->product($token);
        $warehouse = $this->warehouse($token, 'مخزن الدمام');
        $supplier = $this->supplier($token);
        $purchase = $this->buy($token, $supplier, $product['id'], $warehouse['id']);

        $return = $this->withToken($token)->postJson('/api/returns', [
            'type' => 'purchase',
            'partner_id' => $supplier,
            'payment_type' => 'credit',
            'original_id' => $purchase['id'],
            'items' => [[
                'product_id' => $product['id'],
                'source_line_id' => $purchase['line_id'],
                'quantity' => 2,
                'unit_price' => 1000,
                'tax_rate' => 0,
            ]],
        ])->assertCreated()['data'];

        $this->assertSame($warehouse['id'], ReturnDocument::findOrFail($return['id'])->warehouse_id);
        $this->withToken($token)->postJson("/api/returns/{$return['id']}/post")->assertOk();
        $this->assertSame(8, (int) ProductWarehouseStock::where('product_id', $product['id'])
            ->where('warehouse_id', $warehouse['id'])->value('quantity'));
    }

    /** @test */
    public function point_of_sale_issues_stock_from_its_selected_warehouse(): void
    {
        $auth = $this->tenant();
        $token = $auth['token'];
        $product = $this->product($token);
        $warehouse = $this->warehouse($token, 'مخزن المعرض');
        $this->buy($token, $this->supplier($token), $product['id'], $warehouse['id'], 5);
        $deviceId = $this->withToken($token)->postJson('/api/pos-devices', [
            'name' => 'كاشير المعرض', 'code' => 'SHOWROOM-POS', 'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $sessionId = $this->withToken($token)
            ->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $deviceId])
            ->assertCreated()['data']['id'];

        $this->withToken($token)->postJson('/api/pos/checkout', [
            'partner_id' => $this->customer($token),
            'pos_session_id' => $sessionId,
            'warehouse_id' => $warehouse['id'],
            'tax_inclusive' => false,
            'items' => [[
                'product_id' => $product['id'], 'quantity' => 2, 'unit_price' => 2000, 'tax_rate' => 0,
            ]],
            'tenders' => ['cash' => 4000, 'card' => 0, 'transfer' => 0, 'credit' => 0],
        ])->assertCreated();

        $this->assertSame(3, (int) ProductWarehouseStock::where('product_id', $product['id'])
            ->where('warehouse_id', $warehouse['id'])->value('quantity'));
    }

    /** @test */
    public function a_foreign_tenant_warehouse_is_rejected_on_document_creation(): void
    {
        $a = $this->tenant();
        $product = $this->product($a['token']);
        $supplier = $this->supplier($a['token']);

        $b = $this->registerTenant('other', 'warehouse-other@nibras.test');
        $foreignWarehouseId = $this->withToken($b['token'])->getJson('/api/warehouses')
            ->assertOk()['data'][0]['id'];
        app(TenantContext::class)->set($a['tenant_id']);

        $this->withToken($a['token'])->postJson('/api/purchases', [
            'partner_id' => $supplier,
            'warehouse_id' => $foreignWarehouseId,
            'payment_type' => 'credit',
            'items' => [[
                'product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 0,
            ]],
        ])->assertStatus(422);
    }
}
