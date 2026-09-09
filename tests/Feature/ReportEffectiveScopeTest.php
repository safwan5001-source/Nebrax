<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\User;
use App\Support\SpreadsheetReader;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
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
    protected string $thirdWarehouseId;
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
        $this->thirdWarehouseId = $this->withToken($this->ownerToken)->postJson('/api/warehouses', [
            'name' => 'مخزن ثالث مسموح', 'code' => 'RPT-WH-THIRD',
            'branch_id' => $this->mainBranchId, 'is_active' => true,
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

    /** Persona D — restricted to MAIN branch AND two warehouses (main + third). */
    protected function restrictedToMainAndThirdWarehouse(string $email): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $user = User::create([
            'tenant_id' => $this->tenantId, 'name' => 'موظف مقيّد بمخزنين',
            'email' => $email, 'password' => 'password123', 'role' => 'admin',
        ]);
        $user->branches()->sync([$this->mainBranchId]);
        $user->warehouses()->sync([$this->mainWarehouseId, $this->thirdWarehouseId]);

        return $user->createToken('api')->plainTextToken;
    }

    /**
     * Persona E — restricted to MAIN branch/warehouse but on the `staff`
     * system role, which carries `products.view` without `products.view_cost`
     * (`Rbac::MATRIX['staff']`) — proves cost redaction and warehouse scope
     * are independent controls.
     */
    protected function restrictedToMainWarehouseWithoutCostPermission(string $email): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $user = User::create([
            'tenant_id' => $this->tenantId, 'name' => 'موظف بلا صلاحية تكلفة',
            'email' => $email, 'password' => 'password123', 'role' => 'staff',
        ]);
        $user->branches()->sync([$this->mainBranchId]);
        $user->warehouses()->sync([$this->mainWarehouseId]);

        return $user->createToken('api')->plainTextToken;
    }

    /** @return array<int, array<int, string>> */
    protected function readCsv(TestResponse $response): array
    {
        $path = tempnam(sys_get_temp_dir(), 'rpt-scope-csv-');
        file_put_contents($path, $response->streamedContent());
        $rows = SpreadsheetReader::read($path, 'csv', 60000, 200);
        @unlink($path);

        return $rows;
    }

    /** @param array<int, array<int, string>> $rows */
    protected function csvColumn(array $rows, string $header): array
    {
        $index = array_search($header, $rows[0], true);
        $this->assertNotFalse($index, "العمود «{$header}» غير موجود في الملف المصدَّر.");

        return array_column(array_slice($rows, 1), $index);
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

    // ═════════════════════════════════════════════════════════════════
    //  PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE — /api/inventory/export and
    //  InventoryReportService::inventoryValue() (view=value). Quantity and
    //  stock_value are scoped to the actor's Effective Warehouse Scope;
    //  avg_cost stays the tenant-wide Product.avg_cost, unchanged — never
    //  recomputed per warehouse (docs/plans/products-inventory/
    //  AWJ_INVENTORY_VALUATION_SEMANTICS.md).
    // ═════════════════════════════════════════════════════════════════

    /** @test — Export: unrestricted user still sees the full tenant-wide quantity — backward compatibility. */
    public function export_unrestricted_user_sees_full_tenant_wide_quantity(): void
    {
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 12, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7]);

        $rows = $this->readCsv($this->withToken($this->ownerToken)
            ->get('/api/inventory/export?format=csv&locale=en&include_zero=1')->assertOk());

        $index = array_search('RPT-SCOPE-TRACKED', $this->csvColumn($rows, 'SKU'), true);
        $this->assertNotFalse($index);
        $this->assertSame('12', $this->csvColumn($rows, 'Quantity')[$index], 'Unrestricted export must keep the tenant-wide quantity.');
    }

    /** @test — Export: a user restricted to one warehouse sees only that warehouse's quantity, not the tenant total. */
    public function export_restricted_to_one_warehouse_sees_only_that_warehouses_quantity(): void
    {
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 12, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7]);

        $restricted = $this->restrictedToMainBranchAndWarehouse('export-one-wh@rpt-scope.test');
        $rows = $this->readCsv($this->withToken($restricted)
            ->get('/api/inventory/export?format=csv&locale=en&include_zero=1')->assertOk());

        $index = array_search('RPT-SCOPE-TRACKED', $this->csvColumn($rows, 'SKU'), true);
        $this->assertNotFalse($index);
        $this->assertSame('5', $this->csvColumn($rows, 'Quantity')[$index], 'Restricted export leaked the forbidden warehouse quantity.');
        // Stock value must follow the SAME scoped quantity, not the tenant-wide one: 5 * 100.00 SAR = 500.00.
        $this->assertSame('500.00', $this->csvColumn($rows, 'Inventory value')[$index]);
    }

    /** @test — Export: a user restricted to two warehouses sees the sum of exactly those two, excluding the third. */
    public function export_restricted_to_multiple_warehouses_sums_only_allowed(): void
    {
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 15, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->thirdWarehouseId, 'quantity' => 3]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7]);

        $restricted = $this->restrictedToMainAndThirdWarehouse('export-two-wh@rpt-scope.test');
        $rows = $this->readCsv($this->withToken($restricted)
            ->get('/api/inventory/export?format=csv&locale=en&include_zero=1')->assertOk());

        $index = array_search('RPT-SCOPE-TRACKED', $this->csvColumn($rows, 'SKU'), true);
        $this->assertNotFalse($index);
        $this->assertSame('8', $this->csvColumn($rows, 'Quantity')[$index], 'Must sum exactly the two allowed warehouses (5+3), never the forbidden third (+7=15).');
    }

    /** @test — Export: without products.view_cost, avg_cost/stock_value stay redacted while quantity remains correctly scoped — independent controls. */
    public function export_without_cost_permission_redacts_cost_but_still_scopes_quantity(): void
    {
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 12, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7]);

        $restricted = $this->restrictedToMainWarehouseWithoutCostPermission('export-no-cost@rpt-scope.test');
        $rows = $this->readCsv($this->withToken($restricted)
            ->get('/api/inventory/export?format=csv&locale=en&include_zero=1')->assertOk());

        $index = array_search('RPT-SCOPE-TRACKED', $this->csvColumn($rows, 'SKU'), true);
        $this->assertNotFalse($index);
        $this->assertSame('5', $this->csvColumn($rows, 'Quantity')[$index], 'Quantity scope must still apply regardless of cost permission.');
        $this->assertSame('', $this->csvColumn($rows, 'Average cost')[$index], 'avg_cost must stay redacted without products.view_cost.');
        $this->assertSame('', $this->csvColumn($rows, 'Inventory value')[$index], 'stock_value must stay redacted without products.view_cost.');
    }

    /** @test — Export: include_zero=false drops a product whose SCOPED quantity is zero, even though its tenant-wide quantity is not. */
    public function export_include_zero_false_excludes_a_product_zero_in_scope_but_nonzero_tenant_wide(): void
    {
        // All of this product's real stock sits in the FORBIDDEN warehouse.
        // Tenant-wide quantity_on_hand is 7 (nonzero), but the restricted
        // user's effective scope is 0 — must be excluded, not shown as 7.
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 7, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7]);

        $restricted = $this->restrictedToMainBranchAndWarehouse('export-zero-scope@rpt-scope.test');
        $rows = $this->readCsv($this->withToken($restricted)
            ->get('/api/inventory/export?format=csv&locale=en&include_zero=0')->assertOk());

        $this->assertNotContains('RPT-SCOPE-TRACKED', $this->csvColumn($rows, 'SKU'), 'A product with zero SCOPED quantity must be excluded by include_zero=false, even though the tenant-wide quantity is 7.');
    }

    /** @test — Export: include_zero=true keeps that same product, now showing its correctly scoped zero. */
    public function export_include_zero_true_shows_the_scoped_zero_not_the_tenant_wide_quantity(): void
    {
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 7, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7]);

        $restricted = $this->restrictedToMainBranchAndWarehouse('export-zero-scope-shown@rpt-scope.test');
        $rows = $this->readCsv($this->withToken($restricted)
            ->get('/api/inventory/export?format=csv&locale=en&include_zero=1')->assertOk());

        $index = array_search('RPT-SCOPE-TRACKED', $this->csvColumn($rows, 'SKU'), true);
        $this->assertNotFalse($index);
        $this->assertSame('0', $this->csvColumn($rows, 'Quantity')[$index], 'Must show the scoped 0, not the tenant-wide 7.');
    }

    /** @test — Export: pre-warehouse/null-warehouse legacy quantity is never lost for an unrestricted user. */
    public function export_unrestricted_user_keeps_legacy_null_warehouse_quantity(): void
    {
        // Simulates quantity that predates warehouses (a movement with no
        // warehouse_id): present in quantity_on_hand but in NO
        // product_warehouse_stock row at all — the exact case
        // AWJ_INVENTORY_VALUATION_SEMANTICS.md §2 documents.
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 9, 'avg_cost' => 10000]);
        // Deliberately no ProductWarehouseStock rows at all for this product.

        $rows = $this->readCsv($this->withToken($this->ownerToken)
            ->get('/api/inventory/export?format=csv&locale=en&include_zero=1')->assertOk());

        $index = array_search('RPT-SCOPE-TRACKED', $this->csvColumn($rows, 'SKU'), true);
        $this->assertNotFalse($index);
        $this->assertSame('9', $this->csvColumn($rows, 'Quantity')[$index], 'Unrestricted export must not silently lose pre-warehouse legacy quantity.');
    }

    /** @test — Export: tenant isolation holds for the new per-warehouse SUM query itself, not just the base product list. */
    public function export_scoped_sum_query_never_crosses_tenant_boundary(): void
    {
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 5, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5]);

        $other = $this->registerTenant('rpt-scope-nt-export', 'nt-export@rpt-scope.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $otherProductId = Product::create([
            'tenant_id' => $other['tenant_id'], 'name' => 'صنف مستأجر آخر',
            'sku' => 'RPT-SCOPE-TRACKED', 'unit' => 'piece', 'type' => 'good',
            'track_inventory' => true, 'quantity_on_hand' => 999, 'avg_cost' => 10000,
        ])->id;
        $otherWarehouseId = $this->withToken($other['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن مستأجر آخر', 'code' => 'NT-WH',
        ])->assertCreated()['data']['id'];
        ProductWarehouseStock::create(['tenant_id' => $other['tenant_id'], 'product_id' => $otherProductId, 'warehouse_id' => $otherWarehouseId, 'quantity' => 999]);
        app(TenantContext::class)->set($this->tenantId);

        $restricted = $this->restrictedToMainBranchAndWarehouse('export-cross-tenant@rpt-scope.test');
        $rows = $this->readCsv($this->withToken($restricted)
            ->get('/api/inventory/export?format=csv&locale=en&include_zero=1')->assertOk());

        // Only tenant A's row for this SKU, at tenant A's scoped quantity — never tenant B's 999.
        $skus = $this->csvColumn($rows, 'SKU');
        $this->assertCount(1, array_filter($skus, fn ($sku) => $sku === 'RPT-SCOPE-TRACKED'), 'CRITICAL — cross-tenant row leaked into the export.');
        $index = array_search('RPT-SCOPE-TRACKED', $skus, true);
        $this->assertSame('5', $this->csvColumn($rows, 'Quantity')[$index], 'CRITICAL — cross-tenant warehouse quantity leaked into the scoped sum.');
    }

    /** @test — view=value: scopes quantity and stock_value to the allowed warehouse; avg_cost stays tenant-wide unchanged. */
    public function inventory_value_view_scopes_quantity_and_stock_value_to_allowed_warehouses(): void
    {
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 12, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7]);

        $restricted = $this->restrictedToMainBranchAndWarehouse('value-scoped@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/inventory?view=value')->assertOk()->json();

        $row = collect($report['data'])->firstWhere('sku', 'RPT-SCOPE-TRACKED');
        $this->assertNotNull($row);
        $this->assertSame(5, $row['quantity'], 'view=value leaked the forbidden warehouse quantity into the row.');
        $this->assertSame('100.00', $row['avg_cost'], 'avg_cost must stay the unchanged tenant-wide Product.avg_cost.');
        $this->assertSame('500.00', $row['stock_value'], 'stock_value must be the scoped quantity (5) times the unchanged tenant-wide avg_cost, not 12 * avg_cost.');
        // Totals must reflect the same scope — no leak through the aggregate.
        $this->assertSame(5, $report['totals']['quantity'], 'view=value totals leaked the forbidden warehouse quantity.');
    }

    /** @test — view=value: unrestricted user keeps the tenant-wide totals — backward compatibility, mirrors view=warehouses. */
    public function inventory_value_view_unrestricted_shows_tenant_wide_totals(): void
    {
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 12, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->mainWarehouseId, 'quantity' => 5]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7]);

        $report = $this->withToken($this->ownerToken)
            ->getJson('/api/reports/inventory?view=value')->assertOk()->json();

        $row = collect($report['data'])->firstWhere('sku', 'RPT-SCOPE-TRACKED');
        $this->assertSame(12, $row['quantity'], 'Unrestricted owner was unexpectedly narrowed on view=value — backward compatibility broken.');
        $this->assertSame(12, $report['totals']['quantity']);
    }

    /** @test — view=value: hide_zero excludes a product whose SCOPED quantity is zero, even though its tenant-wide quantity is not. */
    public function inventory_value_view_hide_zero_uses_the_scoped_quantity_not_the_tenant_wide_one(): void
    {
        Product::whereKey($this->trackedProductId)->update(['quantity_on_hand' => 7, 'avg_cost' => 10000]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->trackedProductId, 'warehouse_id' => $this->otherWarehouseId, 'quantity' => 7]);

        $restricted = $this->restrictedToMainBranchAndWarehouse('value-hide-zero@rpt-scope.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/inventory?view=value&hide_zero=1')->assertOk()->json();

        $row = collect($report['data'])->firstWhere('sku', 'RPT-SCOPE-TRACKED');
        $this->assertNull($row, 'hide_zero must exclude a product whose scoped quantity is 0, even though tenant-wide quantity is 7.');
    }
}
