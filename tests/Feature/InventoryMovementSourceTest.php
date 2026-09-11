<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Warehouse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InventoryMovementSourceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $tenantId;
    private string $ownerToken;
    private Product $product;
    private Warehouse $warehouse;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant('mov-src', 'owner@mov-src.test');
        $this->ownerToken = $auth['token'];
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        $this->product = Product::create([
            'tenant_id' => $this->tenantId, 'name' => 'صنف حركة', 'sku' => 'MOV-01',
            'type' => 'good', 'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 2500,
        ]);
        $this->warehouse = Warehouse::create([
            'tenant_id' => $this->tenantId, 'code' => 'WH-M', 'name' => 'مخزن الحركات',
        ]);
    }

    /** @test */
    public function authorized_owner_receives_invoice_source_metadata_and_open_route(): void
    {
        $invoice = $this->makeInvoice('INV-100');
        $this->movement(Invoice::class, $invoice->id);

        $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'invoice')
            ->assertJsonPath('data.0.source.label', 'فاتورة مبيعات')
            ->assertJsonPath('data.0.source.reference', 'INV-100')
            ->assertJsonPath('data.0.source.can_open', true)
            ->assertJsonPath('data.0.source.route', '/invoices/'.$invoice->id);
    }

    /** @test */
    public function user_who_can_see_movement_without_invoice_permission_does_not_receive_protected_source(): void
    {
        $invoice = $this->makeInvoice('INV-LOCKED');
        $this->movement(Invoice::class, $invoice->id);
        $token = $this->tokenWithPermissions(['products.view']);

        $this->withToken($token)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'invoice')
            ->assertJsonPath('data.0.source.reference', null)
            ->assertJsonPath('data.0.source.can_open', false)
            ->assertJsonPath('data.0.source.route', null);
    }

    /** @test */
    public function cross_tenant_source_id_does_not_resolve_foreign_metadata(): void
    {
        $foreign = $this->registerTenant('other-mov', 'owner@other-mov.test');
        app(TenantContext::class)->set($foreign['tenant_id']);
        $foreignPartner = Partner::create([
            'tenant_id' => $foreign['tenant_id'], 'name' => 'عميل أجنبي', 'type' => 'customer', 'is_active' => true,
        ]);
        $foreignInvoice = Invoice::create([
            'tenant_id' => $foreign['tenant_id'], 'partner_id' => $foreignPartner->id, 'number' => 'FOREIGN-9', 'status' => 'posted',
            'invoice_date' => '2026-09-01', 'type' => 'sale', 'payment_type' => 'credit',
            'subtotal' => 0, 'tax_amount' => 0, 'total' => 0,
        ]);

        app(TenantContext::class)->set($this->tenantId);
        $this->movement(Invoice::class, $foreignInvoice->id);

        $body = $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'unknown')
            ->assertJsonPath('data.0.source.reference', null)
            ->assertJsonPath('data.0.source.can_open', false)
            ->json();
        $this->assertStringNotContainsString('FOREIGN-9', json_encode($body));
    }

    /** @test */
    public function unknown_and_missing_sources_return_deterministic_fallback(): void
    {
        StockMovement::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->product->id, 'warehouse_id' => $this->warehouse->id,
            'type' => 'in', 'quantity' => 1, 'unit_cost' => 2500, 'total_cost' => 2500, 'balance_quantity' => 11,
            'source_type' => 'NotARealModel', 'source_id' => '00000000-0000-0000-0000-000000000001',
            'movement_date' => '2026-09-01',
        ]);
        StockMovement::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->product->id, 'warehouse_id' => $this->warehouse->id,
            'type' => 'in', 'quantity' => 1, 'unit_cost' => 2500, 'total_cost' => 2500, 'balance_quantity' => 12,
            'source_type' => Invoice::class, 'source_id' => '00000000-0000-0000-0000-000000000099',
            'movement_date' => '2026-09-02',
        ]);

        $res = $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonCount(2, 'data');
        foreach ($res['data'] as $row) {
            $this->assertFalse($row['source']['can_open']);
            $this->assertNull($row['source']['route']);
        }
    }

    /** @test */
    public function cost_fields_remain_redacted_without_view_cost(): void
    {
        $invoice = $this->makeInvoice('INV-COST');
        $this->movement(Invoice::class, $invoice->id);
        $token = $this->tokenWithPermissions(['products.view', 'invoices.view']);

        $this->withToken($token)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.unit_cost', null)
            ->assertJsonPath('data.0.total_cost', null)
            ->assertJsonPath('data.0.source.reference', 'INV-COST');
    }

    /** @test */
    public function resolution_does_not_mutate_stock_or_journals(): void
    {
        $invoice = $this->makeInvoice('INV-RO');
        $this->movement(Invoice::class, $invoice->id);
        $movements = StockMovement::count();
        $journals = JournalEntry::count();
        $qty = $this->product->fresh()->quantity_on_hand;

        $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")->assertOk();

        $this->assertSame($movements, StockMovement::count());
        $this->assertSame($journals, JournalEntry::count());
        $this->assertSame($qty, $this->product->fresh()->quantity_on_hand);
    }

    private function makeInvoice(string $number): Invoice
    {
        $partner = Partner::create([
            'tenant_id' => $this->tenantId, 'name' => 'عميل مصدر', 'type' => 'customer', 'is_active' => true,
        ]);

        return Invoice::create([
            'tenant_id' => $this->tenantId, 'partner_id' => $partner->id, 'number' => $number,
            'status' => 'posted', 'invoice_date' => '2026-09-01', 'type' => 'sale',
            'payment_type' => 'credit', 'subtotal' => 0, 'tax_amount' => 0, 'total' => 0,
        ]);
    }

    private function movement(string $sourceType, string $sourceId): StockMovement
    {
        return StockMovement::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->product->id, 'warehouse_id' => $this->warehouse->id,
            'type' => 'out', 'quantity' => 1, 'unit_cost' => 2500, 'total_cost' => 2500, 'balance_quantity' => 9,
            'source_type' => $sourceType, 'source_id' => $sourceId, 'movement_date' => '2026-09-01',
        ]);
    }

    private function tokenWithPermissions(array $permissions): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $slug = 'movsrc-'.substr(sha1(implode(',', $permissions)), 0, 8);
        Role::create([
            'tenant_id' => $this->tenantId, 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions,
        ]);
        $user = User::create([
            'tenant_id' => $this->tenantId, 'name' => $slug, 'email' => $slug.'@mov-src.test',
            'password' => 'password123', 'role' => $slug, 'is_active' => true,
        ]);

        return $user->createToken('api')->plainTextToken;
    }
}
