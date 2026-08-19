<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\StockMovement;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** نافذة مخزون الفاتورة تقرأ الحركات الموثقة فقط ولا تنشئ إذناً أو صرفاً جديداً. */
class InvoiceInventoryApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_returns_only_the_stock_movements_recorded_from_the_visible_invoice(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'صنف متتبّع', 'sku' => 'STK-01',
            'type' => 'good', 'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 2500,
        ]);
        $invoice = $this->invoice($auth['token'], $product->id);
        $otherInvoice = $this->invoice($auth['token'], $product->id);

        StockMovement::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'type' => 'out',
            'quantity' => 2, 'unit_cost' => 2500, 'total_cost' => 5000, 'balance_quantity' => 8,
            'source_type' => \App\Models\Invoice::class, 'source_id' => $invoice['id'],
            'movement_date' => '2026-08-20', 'notes' => 'بيع عبر الفاتورة '.$invoice['number'],
        ]);
        StockMovement::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'type' => 'out',
            'quantity' => 1, 'unit_cost' => 2500, 'total_cost' => 2500, 'balance_quantity' => 7,
            'source_type' => \App\Models\Invoice::class, 'source_id' => $otherInvoice['id'],
            'movement_date' => '2026-08-20', 'notes' => 'فاتورة أخرى',
        ]);

        $this->withToken($auth['token'])->getJson("/api/invoices/{$invoice['id']}/inventory")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', 'out')
            ->assertJsonPath('data.0.quantity', 2)
            ->assertJsonPath('data.0.total_cost', '50.00')
            ->assertJsonPath('data.0.product.sku', 'STK-01');
    }

    /** @test */
    public function another_branch_cannot_read_inventory_movements_for_an_invoice_outside_its_scope(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $mainBranch = $this->withToken($token)->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $otherBranch = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع مخزون آخر'])->assertCreated()['data']['id'];
        $product = Product::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'صنف فرع', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 5, 'avg_cost' => 1000,
        ]);
        $invoice = $this->invoice($token, $product->id, $otherBranch);

        $this->withToken($token)->withHeaders(['X-Branch-Id' => $mainBranch])
            ->getJson("/api/invoices/{$invoice['id']}/inventory")
            ->assertNotFound();
    }

    private function invoice(string $token, string $productId, ?string $branchId = null): array
    {
        $partner = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل حركة مخزون', 'type' => 'customer',
        ])->assertCreated()['data'];
        $request = $this->withToken($token);
        if ($branchId !== null) {
            $request = $request->withHeaders(['X-Branch-Id' => $branchId]);
        }

        return $request->postJson('/api/invoices', [
            'partner_id' => $partner['id'],
            'payment_type' => 'credit',
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
    }
}
