<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PR-ACL-REPORT-SCOPE — permanent regression suite.
 *
 * Proves the Effective Branch/Warehouse Scope invariant from
 * docs/plans/access-control/AWJ_ACCESS_CONTROL_V2_TARGET_CONTRACT.md §4/§5/§8
 * across the five analytical report families: Sales, Purchase, Inventory,
 * Customer, Classification Analytics.
 *
 *   Effective Branch Scope  = requested branch_id ∩ User::allowedBranchIds()
 *   Effective Warehouse Scope = requested warehouse_id ∩ User::allowedWarehouseIds()
 *
 * A restricted user must never see rows, totals, or KPIs from a branch or
 * warehouse outside their allowed set — not by omitting the filter, and not
 * by explicitly requesting a forbidden one. Because every report's
 * client-side CSV/PDF export renders from the exact same JSON the table
 * uses (verified separately — see the Access Control V2 verification
 * evidence), fixing rows+totals here fixes the export by construction; no
 * export-specific test is needed.
 *
 * Fixture: one tenant, MAIN branch (allowed) + OTHER branch (forbidden),
 * MAIN warehouse (allowed) + OTHER warehouse (forbidden, inside OTHER
 * branch). The owner token seeds data in both; a restricted persona
 * (allowed only in MAIN branch / MAIN warehouse) exercises every report.
 */
class ReportEffectiveScopeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected string $ownerToken;
    protected string $tenantId;
    protected string $mainBranchId;
    protected string $otherBranchId;
    protected string $mainWarehouseId;
    protected string $otherWarehouseId;
    protected string $supplierId;
    protected string $customerId;
    protected string $productId;
    protected string $trackedProductId;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('rpt-scope', 'owner@rpt-scope.test');
        $this->ownerToken = $auth['token'];
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);

        $this->mainBranchId = $this->withToken($this->ownerToken)
            ->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $this->otherBranchId = $this->withToken($this->ownerToken)
            ->postJson('/api/branches', ['name' => 'فرع محظور', 'code' => 'RPT-FRB'])
            ->assertCreated()['data']['id'];

        $this->supplierId = $this->withToken($this->ownerToken)
            ->postJson('/api/partners', ['name' => 'مورد نطاق', 'type' => 'supplier'])
            ->assertCreated()['data']['id'];
        $this->customerId = $this->withToken($this->ownerToken)
            ->postJson('/api/partners', ['name' => 'عميل نطاق', 'type' => 'customer'])
            ->assertCreated()['data']['id'];

        $this->mainWarehouseId = $this->withToken($this->ownerToken)->postJson('/api/warehouses', [
            'name' => 'مخزن رئيسي', 'code' => 'RPT-WH-MAIN',
            'branch_id' => $this->mainBranchId, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $this->otherWarehouseId = $this->withToken($this->ownerToken)->postJson('/api/warehouses', [
            'name' => 'مخزن محظور', 'code' => 'RPT-WH-OTHER',
            'branch_id' => $this->otherBranchId, 'is_active' => true,
        ])->assertCreated()['data']['id'];

        $this->productId = $this->withToken($this->ownerToken)->postJson('/api/products', [
            'name' => 'صنف نطاق', 'sku' => 'RPT-SCOPE-1', 'type' => 'good',
            'purchase_price' => 10000, 'sale_price' => 20000, 'track_inventory' => false,
        ])->assertCreated()['data']['id'];

        // Inventory tests need a track_inventory=true product to pass the
        // warehouses/movements views' `products.track_inventory = true`
        // filter — created directly (not via the invoice/purchase API) so
        // it never touches Sales/Purchase stock-availability validation.
        $this->trackedProductId = Product::create([
            'tenant_id' => $this->tenantId, 'name' => 'صنف متتبَّع للمخزون',
            'sku' => 'RPT-SCOPE-TRACKED', 'unit' => 'piece', 'type' => 'good',
            'track_inventory' => true, 'sale_price' => 20000,
        ])->id;
    }

    /** Persona B — restricted to MAIN branch only. Not warehouse-restricted unless noted. */
    protected function restrictedToMainBranch(string $email): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $user = User::create([
            'tenant_id' => $this->tenantId, 'name' => 'موظف مقيّد بفرع',
            'email' => $email, 'password' => 'password123', 'role' => 'admin',
        ]);
        $user->branches()->sync([$this->mainBranchId]);

        return $user->createToken('api')->plainTextToken;
    }

    /** Persona C — restricted to MAIN branch AND MAIN warehouse. */
    protected function restrictedToMainBranchAndWarehouse(string $email): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $user = User::create([
            'tenant_id' => $this->tenantId, 'name' => 'موظف مقيّد بمخزن',
            'email' => $email, 'password' => 'password123', 'role' => 'admin',
        ]);
        $user->branches()->sync([$this->mainBranchId]);
        $user->warehouses()->sync([$this->mainWarehouseId]);

        return $user->createToken('api')->plainTextToken;
    }

    protected function money(mixed $riyalString): int
    {
        return (int) round(((float) $riyalString) * 100);
    }

    protected function postedInvoice(string $branchId, int $amount): string
    {
        $invoice = $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson('/api/invoices', [
                'partner_id' => $this->customerId,
                'payment_type' => 'credit',
                'invoice_date' => '2026-02-10',
                'items' => [['product_id' => $this->productId, 'quantity' => 1, 'unit_price' => $amount, 'tax_rate' => 0]],
            ])->assertCreated()['data'];

        $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        return $invoice['id'];
    }

    protected function postedPurchase(string $branchId, int $amount): string
    {
        $purchase = $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson('/api/purchases', [
                'partner_id' => $this->supplierId,
                'payment_type' => 'credit',
                'purchase_date' => '2026-02-10',
                'items' => [['product_id' => $this->productId, 'quantity' => 1, 'unit_price' => $amount, 'tax_rate' => 0]],
            ])->assertCreated()['data'];

        $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        return $purchase['id'];
    }

    // ═════════════════════════════════════════════════════════════════
    //  SALES — SalesReportService.php:80-83, :285-288 (now via ReportBranchScope)
    // ═════════════════════════════════════════════════════════════════

    /** @test — Sales: no filter ⇒ rows/totals restricted to MAIN only. */
    public function sales_report_without_filter_returns_only_allowed_branch_rows_and_totals(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('sales-allow@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/sales?view=period&interval=month')->assertOk()->json();

        $rowsMinor = array_sum(array_map(fn (array $r) => $this->money($r['amount']), $report['data']));
        $this->assertSame(100000, $rowsMinor, 'Sales report rows leaked the forbidden branch.');
        $this->assertSame(100000, $this->money($report['totals']['amount']), 'Sales report totals leaked the forbidden branch.');
    }

    /** @test — Sales: explicit forbidden branch_id must not leak that branch's data. */
    public function sales_report_forbidden_explicit_branch_does_not_leak(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('sales-deny@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/sales?view=period&interval=month&branch_id[]=' . $this->otherBranchId)
            ->assertOk()->json();

        $totalsMinor = $this->money($report['totals']['amount']);
        $this->assertNotSame(900000, $totalsMinor, 'Sales report honored a forbidden explicit branch filter.');
        // Existing AWJ Effective Scope contract (ReportService::branchIds()):
        // a fully-forbidden explicit request falls back to the user's own
        // allowed set — never to the forbidden branch, never to an empty
        // result that could be confused with "no data at all".
        $this->assertSame(100000, $totalsMinor);
    }

    /** @test — Sales: profit view (a different totals path) is scoped too. */
    public function sales_profit_view_totals_are_scoped(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('sales-profit@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/sales?view=profit&interval=month')->assertOk()->json();

        $this->assertSame(100000, $this->money($report['totals']['revenue']), 'Sales profit-view revenue leaked the forbidden branch.');
    }

    /** @test — Sales: receipts (payments) view — a separate query family — is scoped too. */
    public function sales_payments_view_is_scoped(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        \App\Models\Payment::create([
            'tenant_id' => $this->tenantId, 'number' => 'RPT-SALES-RCPT-MAIN', 'partner_id' => $this->customerId,
            'branch_id' => $this->mainBranchId, 'direction' => 'received', 'method' => 'bank', 'status' => 'posted',
            'payment_date' => '2026-02-15', 'amount' => 50000,
        ]);
        \App\Models\Payment::create([
            'tenant_id' => $this->tenantId, 'number' => 'RPT-SALES-RCPT-OTHER', 'partner_id' => $this->customerId,
            'branch_id' => $this->otherBranchId, 'direction' => 'received', 'method' => 'bank', 'status' => 'posted',
            'payment_date' => '2026-02-15', 'amount' => 700000,
        ]);

        $restricted = $this->restrictedToMainBranch('sales-receipts@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/sales?view=payments&interval=month')->assertOk()->json();

        $this->assertSame(1, $report['totals']['receipts']);
        $this->assertSame(50000, $this->money($report['totals']['amount']));
    }

    // ═════════════════════════════════════════════════════════════════
    //  PURCHASE — PurchaseReportService.php:82-85, :284-287
    // ═════════════════════════════════════════════════════════════════

    /** @test — Purchase: no filter ⇒ rows/totals restricted to MAIN only. */
    public function purchase_report_without_filter_returns_only_allowed_branch_rows_and_totals(): void
    {
        $this->postedPurchase($this->mainBranchId, 100000);
        $this->postedPurchase($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('purchase-allow@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/purchases?view=period&interval=month')->assertOk()->json();

        $rowsMinor = array_sum(array_map(fn (array $r) => $this->money($r['amount']), $report['data']));
        $this->assertSame(100000, $rowsMinor);
        $this->assertSame(100000, $this->money($report['totals']['amount']));
    }

    /** @test — Purchase: explicit forbidden branch_id does not leak that branch's data. */
    public function purchase_report_forbidden_explicit_branch_does_not_leak(): void
    {
        $this->postedPurchase($this->mainBranchId, 100000);
        $this->postedPurchase($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('purchase-deny@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/purchases?view=period&interval=month&branch_id[]=' . $this->otherBranchId)
            ->assertOk()->json();

        $this->assertSame(100000, $this->money($report['totals']['amount']));
    }

    /** @test — Purchase: supplier balances view (a different totals path) is scoped too. */
    public function purchase_balances_view_totals_are_scoped(): void
    {
        $this->postedPurchase($this->mainBranchId, 100000);
        $this->postedPurchase($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('purchase-balances@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/purchases?view=balances')->assertOk()->json();

        $this->assertSame(100000, $this->money($report['totals']['balance']));
    }

    // ═════════════════════════════════════════════════════════════════
    //  INVENTORY — InventoryReportService.php: warehouses/movements/stocktakes
    //  views now scoped via ReportBranchScope + ReportWarehouseScope.
    //  (view=value stays out of scope — see the deferral doc-comment on
    //  InventoryReportService::trackedProducts().)
    // ═════════════════════════════════════════════════════════════════

    /** @test — Inventory: warehouse balances — forbidden warehouse must not appear in rows. */
    public function inventory_warehouse_balances_excludes_forbidden_warehouse_rows(): void
    {
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5,
        ]);
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7,
        ]);

        $restricted = $this->restrictedToMainBranchAndWarehouse('inv-wh@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/inventory?view=warehouses')->assertOk()->json();

        $warehousesSeen = array_column($report['data'], 'warehouse_id');
        $this->assertContains($this->mainWarehouseId, $warehousesSeen);
        $this->assertNotContains($this->otherWarehouseId, $warehousesSeen, 'Forbidden warehouse row leaked.');
    }

    /** @test — Inventory: warehouse balances totals must also exclude forbidden warehouse quantity. */
    public function inventory_warehouse_balances_totals_exclude_forbidden_warehouse_quantity(): void
    {
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5,
        ]);
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7,
        ]);

        $restricted = $this->restrictedToMainBranchAndWarehouse('inv-wh-totals@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/inventory?view=warehouses')->assertOk()->json();

        $this->assertSame(5, $report['totals']['quantity'], 'Inventory totals leaked forbidden warehouse quantity.');
    }

    /** @test — Inventory: explicit forbidden warehouse_id request must not leak that warehouse. */
    public function inventory_warehouse_balances_forbidden_explicit_warehouse_does_not_leak(): void
    {
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5,
        ]);
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7,
        ]);

        $restricted = $this->restrictedToMainBranchAndWarehouse('inv-wh-forbid@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/inventory?view=warehouses&warehouse_id=' . $this->otherWarehouseId)
            ->assertOk()->json();

        $this->assertSame([], $report['data'], 'Explicit forbidden warehouse_id request leaked data.');
    }

    /** @test — Inventory: stock movements — forbidden warehouse movement excluded from rows and totals. */
    public function inventory_movements_excludes_forbidden_warehouse(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        \App\Models\StockMovement::create([
            'tenant_id' => $this->tenantId, 'branch_id' => $this->mainBranchId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->mainWarehouseId, 'type' => 'in', 'quantity' => 5,
            'unit_cost' => 10000, 'total_cost' => 50000, 'balance_quantity' => 5, 'movement_date' => '2026-02-10',
        ]);
        \App\Models\StockMovement::create([
            'tenant_id' => $this->tenantId, 'branch_id' => $this->otherBranchId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->otherWarehouseId, 'type' => 'in', 'quantity' => 7,
            'unit_cost' => 10000, 'total_cost' => 70000, 'balance_quantity' => 7, 'movement_date' => '2026-02-10',
        ]);

        $restricted = $this->restrictedToMainBranchAndWarehouse('inv-mov@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/inventory?view=movements')->assertOk()->json();

        $this->assertCount(1, $report['data']);
        $this->assertSame(50000, $this->money($report['totals']['total_cost']), 'Movement totals leaked forbidden warehouse cost.');
    }

    // ═════════════════════════════════════════════════════════════════
    //  CUSTOMER — CustomerReportService.php: identity vs branch-derived
    //  financial activity (Target Contract §9).
    // ═════════════════════════════════════════════════════════════════

    /** @test — Customer master identity stays visible even when the user cannot see all their branch activity. */
    public function customer_identity_remains_visible_regardless_of_branch_restricted_activity(): void
    {
        $this->postedInvoice($this->otherBranchId, 900000); // customer's only activity is in the forbidden branch

        $restricted = $this->restrictedToMainBranch('cust-identity@rpt-scope.test');
        $this->withToken($restricted)
            ->getJson("/api/partners/{$this->customerId}")
            ->assertOk()
            ->assertJsonPath('data.id', $this->customerId);
    }

    /** @test — Customer sales aggregate: a restricted user sees Customer X only through MAIN-branch activity. */
    public function customer_sales_aggregate_is_scoped_to_allowed_branch_activity(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('cust-sales@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/customers?view=sales')->assertOk()->json();

        $rowsMinor = array_sum(array_map(fn (array $r) => $this->money($r['amount']), $report['data']));
        $this->assertSame(100000, $rowsMinor, 'Customer sales aggregate leaked forbidden-branch activity.');
    }

    /** @test — Customer balances view (a second, independent query) is scoped the same way. */
    public function customer_balances_aggregate_is_scoped_to_allowed_branch_activity(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('cust-balances@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/customers?view=balances')->assertOk()->json();

        $this->assertSame(100000, $this->money($report['totals']['balance']), 'Customer balances totals leaked forbidden-branch activity.');
    }

    // ═════════════════════════════════════════════════════════════════
    //  CLASSIFICATION ANALYTICS — three helper families:
    //  documents() (sales_invoice/purchase_invoice), payments()
    //  (receipt/payment), partners() (customer/supplier).
    // ═════════════════════════════════════════════════════════════════

    /** @test — Classification: documents() family — sales_invoice scope is branch-restricted. */
    public function classification_sales_invoice_scope_is_branch_restricted(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('clas-doc@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/classification-analytics?scope=sales_invoice')->assertOk()->json();

        $this->assertSame(100000, $this->money($report['totals']['amount']), 'Classification sales_invoice scope leaked forbidden-branch data.');
    }

    /** @test — Classification: documents() family — purchase_invoice scope is branch-restricted too. */
    public function classification_purchase_invoice_scope_is_branch_restricted(): void
    {
        $this->postedPurchase($this->mainBranchId, 100000);
        $this->postedPurchase($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('clas-doc-pur@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/classification-analytics?scope=purchase_invoice')->assertOk()->json();

        $this->assertSame(100000, $this->money($report['totals']['amount']));
    }

    /** @test — Classification: payments() family — receipt scope is branch-restricted. */
    public function classification_receipt_scope_is_branch_restricted(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        \App\Models\Payment::create([
            'tenant_id' => $this->tenantId, 'number' => 'RPT-CLAS-RCPT-MAIN', 'partner_id' => $this->customerId,
            'branch_id' => $this->mainBranchId, 'direction' => 'received', 'method' => 'bank', 'status' => 'posted',
            'payment_date' => '2026-02-15', 'amount' => 50000,
        ]);
        \App\Models\Payment::create([
            'tenant_id' => $this->tenantId, 'number' => 'RPT-CLAS-RCPT-OTHER', 'partner_id' => $this->customerId,
            'branch_id' => $this->otherBranchId, 'direction' => 'received', 'method' => 'bank', 'status' => 'posted',
            'payment_date' => '2026-02-15', 'amount' => 700000,
        ]);

        $restricted = $this->restrictedToMainBranch('clas-receipt@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/classification-analytics?scope=receipt')->assertOk()->json();

        $this->assertSame(50000, $this->money($report['totals']['amount']), 'Classification receipt scope leaked forbidden-branch payment.');
    }

    /** @test — Classification: partners() family — customer-derived analytics amount is branch-restricted. */
    public function classification_customer_partner_analytics_amount_is_branch_restricted(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('clas-partner@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/classification-analytics?scope=customer')->assertOk()->json();

        $this->assertSame(100000, $this->money($report['totals']['amount']), 'Classification customer partner analytics leaked forbidden-branch amount.');
    }

    // ═════════════════════════════════════════════════════════════════
    //  NEGATIVE CONTROLS
    // ═════════════════════════════════════════════════════════════════

    /** @test — Cross-tenant: a Tenant B user filtering on a Tenant A branch resolves to zero, on every report family. */
    public function cross_tenant_branch_id_never_returns_other_tenants_data(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedPurchase($this->mainBranchId, 100000);

        $other = $this->registerTenant('rpt-scope-nt', 'nt@rpt-scope.test');
        $otherToken = $other['token'];

        $sales = $this->withToken($otherToken)
            ->getJson('/api/reports/sales?view=period&interval=month&branch_id[]=' . $this->mainBranchId)
            ->assertOk()->json();
        $this->assertSame(0, $this->money($sales['totals']['amount']), 'CRITICAL — cross-tenant branch_id leaked sales data.');

        $purchases = $this->withToken($otherToken)
            ->getJson('/api/reports/purchases?view=period&interval=month&branch_id[]=' . $this->mainBranchId)
            ->assertOk()->json();
        $this->assertSame(0, $this->money($purchases['totals']['amount']), 'CRITICAL — cross-tenant branch_id leaked purchase data.');
    }

    /** @test — Cross-tenant: a Tenant B user requesting a Tenant A warehouse_id resolves to zero on the inventory report. */
    public function cross_tenant_warehouse_id_never_returns_other_tenants_inventory_data(): void
    {
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5,
        ]);

        $other = $this->registerTenant('rpt-scope-nt-inv', 'nt-inv@rpt-scope.test');
        $report = $this->withToken($other['token'])
            ->getJson('/api/reports/inventory?view=warehouses&warehouse_id=' . $this->mainWarehouseId)
            ->assertOk()->json();

        $this->assertSame([], $report['data'], 'CRITICAL — cross-tenant warehouse_id leaked inventory data.');
    }

    /** @test — Unrestricted legacy user (no branch assignments) still sees every branch's totals — backward compatibility. */
    public function unrestricted_owner_sees_all_branches_without_narrowing(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        // The tenant owner from setUp() has no branches() assignment ⇒
        // allowedBranchIds() === null ⇒ unrestricted within the tenant.
        $report = $this->withToken($this->ownerToken)
            ->getJson('/api/reports/sales?view=period&interval=month')->assertOk()->json();

        $this->assertSame(1000000, $this->money($report['totals']['amount']), 'Unrestricted owner was unexpectedly narrowed — backward compatibility broken.');
    }

    /** @test — Unrestricted legacy user is also not narrowed on the Inventory warehouse report. */
    public function unrestricted_owner_sees_all_warehouses_without_narrowing(): void
    {
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5,
        ]);
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId,
            'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7,
        ]);

        $report = $this->withToken($this->ownerToken)
            ->getJson('/api/reports/inventory?view=warehouses')->assertOk()->json();

        $this->assertSame(12, $report['totals']['quantity'], 'Unrestricted owner was unexpectedly narrowed on inventory — backward compatibility broken.');
    }
}
