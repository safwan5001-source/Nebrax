<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\InventoryOpening;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\Stocktake;
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
    public function authorized_owner_receives_purchase_source_metadata_and_open_route(): void
    {
        $purchase = $this->makePurchase('PUR-100');
        $this->movement(Purchase::class, $purchase->id);

        $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'purchase')
            ->assertJsonPath('data.0.source.label', 'فاتورة مشتريات')
            ->assertJsonPath('data.0.source.reference', 'PUR-100')
            ->assertJsonPath('data.0.source.can_open', true)
            ->assertJsonPath('data.0.source.route', '/purchases/'.$purchase->id);
    }

    /** @test */
    public function authorized_owner_receives_sales_return_source_metadata_and_open_route(): void
    {
        $doc = $this->makeReturn('RS-100', 'sales');
        $this->movement(ReturnDocument::class, $doc->id);

        $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'sales_return')
            ->assertJsonPath('data.0.source.label', 'مرتجع مبيعات')
            ->assertJsonPath('data.0.source.reference', 'RS-100')
            ->assertJsonPath('data.0.source.can_open', true)
            ->assertJsonPath('data.0.source.route', '/returns/'.$doc->id);
    }

    /** @test */
    public function authorized_owner_receives_purchase_return_source_metadata_and_open_route(): void
    {
        $doc = $this->makeReturn('RP-100', 'purchase');
        $this->movement(ReturnDocument::class, $doc->id);

        $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'purchase_return')
            ->assertJsonPath('data.0.source.label', 'مرتجع مشتريات')
            ->assertJsonPath('data.0.source.reference', 'RP-100')
            ->assertJsonPath('data.0.source.can_open', true)
            ->assertJsonPath('data.0.source.route', '/purchase-returns/'.$doc->id);
    }

    /** @test */
    public function authorized_owner_receives_inventory_opening_source_metadata_and_open_route(): void
    {
        $opening = $this->makeOpening('OPN-100');
        $this->movement(InventoryOpening::class, $opening->id);

        $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'inventory_opening')
            ->assertJsonPath('data.0.source.label', 'رصيد افتتاحي')
            ->assertJsonPath('data.0.source.reference', 'OPN-100')
            ->assertJsonPath('data.0.source.can_open', true)
            ->assertJsonPath('data.0.source.route', '/inventory-openings/'.$opening->id);
    }

    /** @test */
    public function authorized_owner_receives_stock_permit_source_metadata_and_open_route(): void
    {
        $permit = $this->makePermit('SP-100');
        $this->movement(StockPermit::class, $permit->id);

        $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'stock_permit')
            ->assertJsonPath('data.0.source.label', 'إذن مخزون')
            ->assertJsonPath('data.0.source.reference', 'SP-100')
            ->assertJsonPath('data.0.source.can_open', true)
            ->assertJsonPath('data.0.source.route', '/stock-permits/'.$permit->id);
    }

    /** @test */
    public function authorized_owner_receives_stocktake_source_metadata_and_open_route(): void
    {
        $stocktake = $this->makeStocktake('ST-100');
        $this->movement(Stocktake::class, $stocktake->id);

        $this->withToken($this->ownerToken)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'stocktake')
            ->assertJsonPath('data.0.source.label', 'جرد مخزون')
            ->assertJsonPath('data.0.source.reference', 'ST-100')
            ->assertJsonPath('data.0.source.can_open', true)
            ->assertJsonPath('data.0.source.route', '/stocktaking/'.$stocktake->id);
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
    public function user_who_can_see_movement_without_purchase_permission_does_not_receive_protected_source(): void
    {
        $purchase = $this->makePurchase('PUR-LOCKED');
        $this->movement(Purchase::class, $purchase->id);
        $token = $this->tokenWithPermissions(['products.view']);

        $this->withToken($token)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'purchase')
            ->assertJsonPath('data.0.source.reference', null)
            ->assertJsonPath('data.0.source.can_open', false)
            ->assertJsonPath('data.0.source.route', null);
    }

    /** @test */
    public function user_who_can_see_movement_without_returns_permission_does_not_receive_protected_source(): void
    {
        $sales = $this->makeReturn('RS-LOCKED', 'sales');
        $purchase = $this->makeReturn('RP-LOCKED', 'purchase');
        $this->movement(ReturnDocument::class, $sales->id);
        $this->movement(ReturnDocument::class, $purchase->id);
        $token = $this->tokenWithPermissions(['products.view']);

        $rows = $this->withToken($token)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->json('data');

        $this->assertCount(2, $rows);
        foreach ($rows as $row) {
            $this->assertContains($row['source']['type'], ['sales_return', 'purchase_return']);
            $this->assertNull($row['source']['reference']);
            $this->assertFalse($row['source']['can_open']);
            $this->assertNull($row['source']['route']);
        }
    }

    /** @test */
    public function purchase_on_disallowed_branch_does_not_expose_open_source(): void
    {
        [$allowed, $denied] = $this->twoBranches();
        $purchase = $this->makePurchase('PUR-BR', $denied->id);
        $this->movement(Purchase::class, $purchase->id);
        [$token, $user] = $this->restrictedUser(
            ['products.view', 'purchases.view'],
            branchIds: [$allowed->id],
        );

        $this->assertContains((string) $allowed->id, array_map('strval', $user->allowedBranchIds()));
        $this->assertNotContains((string) $denied->id, array_map('strval', $user->allowedBranchIds()));

        $this->withToken($token)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'purchase')
            ->assertJsonPath('data.0.source.reference', null)
            ->assertJsonPath('data.0.source.can_open', false)
            ->assertJsonPath('data.0.source.route', null);
    }

    /** @test */
    public function return_on_disallowed_warehouse_does_not_expose_open_source(): void
    {
        $allowed = Warehouse::create([
            'tenant_id' => $this->tenantId, 'code' => 'WH-OK', 'name' => 'مخزن مسموح',
        ]);
        $denied = Warehouse::create([
            'tenant_id' => $this->tenantId, 'code' => 'WH-NO', 'name' => 'مخزن محظور',
        ]);
        $doc = $this->makeReturn('RS-WH', 'sales', warehouseId: $denied->id);
        $this->movement(ReturnDocument::class, $doc->id);
        [$token, $user] = $this->restrictedUser(
            ['products.view', 'returns.view'],
            warehouseIds: [$allowed->id],
        );

        $this->assertContains((string) $allowed->id, array_map('strval', $user->allowedWarehouseIds()));
        $this->assertNotContains((string) $denied->id, array_map('strval', $user->allowedWarehouseIds()));

        $this->withToken($token)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'sales_return')
            ->assertJsonPath('data.0.source.reference', null)
            ->assertJsonPath('data.0.source.can_open', false)
            ->assertJsonPath('data.0.source.route', null);
    }

    /** @test */
    public function stock_permit_on_disallowed_warehouse_does_not_expose_open_source(): void
    {
        [$allowedBranch, $deniedBranch] = $this->twoBranches();
        $allowedWh = Warehouse::create([
            'tenant_id' => $this->tenantId, 'branch_id' => $allowedBranch->id, 'code' => 'WH-PA', 'name' => 'مخزن إذن مسموح',
        ]);
        $deniedWh = Warehouse::create([
            'tenant_id' => $this->tenantId, 'branch_id' => $deniedBranch->id, 'code' => 'WH-PD', 'name' => 'مخزن إذن محظور',
        ]);
        $permit = $this->makePermit('SP-WH', $deniedBranch->id, $deniedWh->id);
        $this->movement(StockPermit::class, $permit->id);
        [$token] = $this->restrictedUser(
            ['products.view'],
            branchIds: [$allowedBranch->id],
            warehouseIds: [$allowedWh->id],
        );

        $this->withToken($token)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'stock_permit')
            ->assertJsonPath('data.0.source.reference', null)
            ->assertJsonPath('data.0.source.can_open', false)
            ->assertJsonPath('data.0.source.route', null);
    }

    /** @test */
    public function stocktake_on_disallowed_branch_does_not_expose_open_source(): void
    {
        [$allowedBranch, $deniedBranch] = $this->twoBranches();
        $deniedWh = Warehouse::create([
            'tenant_id' => $this->tenantId, 'branch_id' => $deniedBranch->id, 'code' => 'WH-SD', 'name' => 'مخزن جرد محظور',
        ]);
        $stocktake = $this->makeStocktake('ST-BR', $deniedBranch->id, $deniedWh->id);
        $this->movement(Stocktake::class, $stocktake->id);
        [$token] = $this->restrictedUser(
            ['products.view'],
            branchIds: [$allowedBranch->id],
        );

        $this->withToken($token)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'stocktake')
            ->assertJsonPath('data.0.source.reference', null)
            ->assertJsonPath('data.0.source.can_open', false)
            ->assertJsonPath('data.0.source.route', null);
    }

    /** @test */
    public function restricted_user_can_open_source_inside_assigned_branch_and_warehouse(): void
    {
        [$allowedBranch, $deniedBranch] = $this->twoBranches();
        $allowedWh = Warehouse::create([
            'tenant_id' => $this->tenantId, 'branch_id' => $allowedBranch->id, 'code' => 'WH-OK2', 'name' => 'مخزن مسموح ٢',
        ]);
        $permit = $this->makePermit('SP-OK', $allowedBranch->id, $allowedWh->id);
        $this->movement(StockPermit::class, $permit->id);
        [$token] = $this->restrictedUser(
            ['products.view'],
            branchIds: [$allowedBranch->id],
            warehouseIds: [$allowedWh->id],
        );

        $this->withToken($token)->getJson("/api/inventory/{$this->product->id}/movements")
            ->assertOk()
            ->assertJsonPath('data.0.source.type', 'stock_permit')
            ->assertJsonPath('data.0.source.reference', 'SP-OK')
            ->assertJsonPath('data.0.source.can_open', true)
            ->assertJsonPath('data.0.source.route', '/stock-permits/'.$permit->id);
        $this->assertNotSame($deniedBranch->id, $permit->branch_id);
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

    private function makePurchase(string $number, ?string $branchId = null): Purchase
    {
        $partner = Partner::create([
            'tenant_id' => $this->tenantId, 'name' => 'مورد مصدر '.$number, 'type' => 'supplier', 'is_active' => true,
        ]);

        return Purchase::create([
            'tenant_id' => $this->tenantId, 'partner_id' => $partner->id, 'number' => $number,
            'branch_id' => $branchId, 'status' => 'posted', 'purchase_date' => '2026-09-01',
            'payment_type' => 'credit', 'subtotal' => 0, 'tax_amount' => 0, 'total' => 0,
        ]);
    }

    private function makeReturn(string $number, string $type, ?string $branchId = null, ?string $warehouseId = null): ReturnDocument
    {
        $partner = Partner::create([
            'tenant_id' => $this->tenantId,
            'name' => ($type === 'sales' ? 'عميل مرتجع ' : 'مورد مرتجع ').$number,
            'type' => $type === 'sales' ? 'customer' : 'supplier',
            'is_active' => true,
        ]);

        return ReturnDocument::create([
            'tenant_id' => $this->tenantId, 'number' => $number, 'type' => $type,
            'partner_id' => $partner->id, 'branch_id' => $branchId, 'warehouse_id' => $warehouseId,
            'payment_type' => 'credit', 'status' => 'posted', 'return_date' => '2026-09-01',
            'subtotal' => 0, 'tax_amount' => 0, 'total' => 0,
        ]);
    }

    private function makeOpening(string $number): InventoryOpening
    {
        return InventoryOpening::create([
            'tenant_id' => $this->tenantId, 'number' => $number,
            'opening_date' => '2026-09-01', 'status' => 'posted',
        ]);
    }

    private function makePermit(string $number, ?string $branchId = null, ?string $warehouseId = null): StockPermit
    {
        return StockPermit::create([
            'tenant_id' => $this->tenantId, 'type' => 'receipt', 'number' => $number,
            'branch_id' => $branchId, 'warehouse_id' => $warehouseId ?? $this->warehouse->id,
            'permit_date' => '2026-09-01', 'status' => 'posted',
        ]);
    }

    private function makeStocktake(string $number, ?string $branchId = null, ?string $warehouseId = null): Stocktake
    {
        return Stocktake::create([
            'tenant_id' => $this->tenantId, 'number' => $number,
            'branch_id' => $branchId, 'warehouse_id' => $warehouseId ?? $this->warehouse->id,
            'stocktake_date' => '2026-09-01', 'status' => 'posted',
        ]);
    }

    /** @return array{0: Branch, 1: Branch} */
    private function twoBranches(): array
    {
        return [
            Branch::create(['tenant_id' => $this->tenantId, 'code' => 'BR-OK', 'name' => 'فرع مسموح']),
            Branch::create(['tenant_id' => $this->tenantId, 'code' => 'BR-NO', 'name' => 'فرع محظور']),
        ];
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
        return $this->restrictedUser($permissions)[0];
    }

    /**
     * @return array{0: string, 1: User}
     */
    private function restrictedUser(array $permissions, array $branchIds = [], array $warehouseIds = []): array
    {
        app(TenantContext::class)->set($this->tenantId);
        $slug = 'movsrc-'.substr(sha1(implode(',', $permissions).'|'.implode(',', $branchIds).'|'.implode(',', $warehouseIds)), 0, 8);
        Role::create([
            'tenant_id' => $this->tenantId, 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions,
        ]);
        $user = User::create([
            'tenant_id' => $this->tenantId, 'name' => $slug, 'email' => $slug.'@mov-src.test',
            'password' => 'password123', 'role' => $slug, 'is_active' => true,
        ]);
        if ($branchIds !== []) {
            $user->branches()->sync($branchIds);
        }
        if ($warehouseIds !== []) {
            $user->warehouses()->sync($warehouseIds);
        }

        return [$user->createToken('api')->plainTextToken, $user->fresh()];
    }
}
