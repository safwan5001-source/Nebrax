<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Access Control V2 — Report Scope Verification (characterization).
 *
 * Reference: §9, §26 in
 * docs/plans/access-control/AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md.
 *
 * These are CHARACTERIZATION tests: they assert the CURRENT (leaking)
 * behavior so the assertions pass under `php artisan test`, and each test's
 * docblock names the CONFIRMED GAP it captures plus the secure invariant
 * that would replace the current expectation once the gap is fixed. If a
 * future fix flips the runtime, the test fails and points the fixer at the
 * new expectation. NO production change is made here.
 *
 * Discipline:
 *  1. Two-branch fixture per test — one branch allowed, the other forbidden.
 *  2. Prove the runtime consequence by row values, totals and drill-downs.
 *  3. Tenant negative control: cross-tenant IDs never resolve.
 *  4. No production changes anywhere.
 */
class AccessControlV2ReportScopeVerificationTest extends TestCase
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
    protected string $mainProductId;
    protected string $otherProductId;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('awj-rpt', 'owner@awj-rpt.test');
        $this->ownerToken = $auth['token'];
        $this->tenantId = $auth['tenant_id'];

        app(TenantContext::class)->set($this->tenantId);

        $this->mainBranchId = $this->withToken($this->ownerToken)
            ->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $this->otherBranchId = $this->withToken($this->ownerToken)
            ->postJson('/api/branches', ['name' => 'فرع محظور', 'code' => 'FRB'])
            ->assertCreated()['data']['id'];

        $this->supplierId = $this->withToken($this->ownerToken)
            ->postJson('/api/partners', ['name' => 'مورد تقارير', 'type' => 'supplier'])
            ->assertCreated()['data']['id'];
        $this->customerId = $this->withToken($this->ownerToken)
            ->postJson('/api/partners', ['name' => 'عميل تقارير', 'type' => 'customer'])
            ->assertCreated()['data']['id'];

        $this->mainWarehouseId = $this->withToken($this->ownerToken)->postJson('/api/warehouses', [
            'name' => 'مخزن رئيسي', 'code' => 'WH-MAIN',
            'branch_id' => $this->mainBranchId, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $this->otherWarehouseId = $this->withToken($this->ownerToken)->postJson('/api/warehouses', [
            'name' => 'مخزن محظور', 'code' => 'WH-OTHER',
            'branch_id' => $this->otherBranchId, 'is_active' => true,
        ])->assertCreated()['data']['id'];

        $this->mainProductId = $this->withToken($this->ownerToken)->postJson('/api/products', [
            'name' => 'صنف رئيسي', 'sku' => 'RPT-MAIN', 'type' => 'good',
            'purchase_price' => 10000, 'sale_price' => 20000, 'track_inventory' => false,
        ])->assertCreated()['data']['id'];
        $this->otherProductId = $this->withToken($this->ownerToken)->postJson('/api/products', [
            'name' => 'صنف محظور', 'sku' => 'RPT-OTHER', 'type' => 'good',
            'purchase_price' => 10000, 'sale_price' => 20000, 'track_inventory' => false,
        ])->assertCreated()['data']['id'];
    }

    /** Persona B — restricted to the main branch only. */
    protected function restrictedToMainBranch(string $email = 'restricted@awj-rpt.test'): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $user = User::create([
            'tenant_id' => $this->tenantId,
            'name' => 'موظف مقيّد',
            'email' => $email,
            'password' => 'password123',
            'role' => 'admin', // admin retains reports.view; branch scope handles isolation
        ]);
        $user->branches()->sync([$this->mainBranchId]);

        return $user->createToken('api')->plainTextToken;
    }

    protected function postedPurchase(string $branchId, int $amount): string
    {
        $purchase = $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson('/api/purchases', [
                'partner_id' => $this->supplierId,
                'payment_type' => 'credit',
                'purchase_date' => '2026-02-10',
                'items' => [[
                    'product_id' => $this->mainProductId,
                    'quantity' => 1,
                    'unit_price' => $amount,
                    'tax_rate' => 0,
                ]],
            ])->assertCreated()['data'];

        $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson("/api/purchases/{$purchase['id']}/post")
            ->assertOk();

        return $purchase['id'];
    }

    protected function postedInvoice(string $branchId, int $amount): string
    {
        $invoice = $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson('/api/invoices', [
                'partner_id' => $this->customerId,
                'payment_type' => 'credit',
                'invoice_date' => '2026-02-10',
                'items' => [[
                    'product_id' => $this->mainProductId,
                    'quantity' => 1,
                    'unit_price' => $amount,
                    'tax_rate' => 0,
                ]],
            ])->assertCreated()['data'];

        $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson("/api/invoices/{$invoice['id']}/post")
            ->assertOk();

        return $invoice['id'];
    }

    // ═════════════════════════════════════════════════════════════════
    //  A2 — Purchase Report — CONFIRMED GAP.
    //
    //  Static evidence:
    //   - app/Services/Reporting/PurchaseReportService.php:65 →
    //     `Purchase::query()->withoutGlobalScope(BranchScope::class)`.
    //   - :82-85 → applies only the client-supplied `branch_id` filter,
    //     with no intersection against `User::allowedBranchIds()`.
    //
    //  Reference: §9 (Report scope invariant) + §26 (Generic report
    //  effective scope — multiple likely bypasses).
    //
    //  Secure invariant (what the tests below would assert after a fix):
    //   Report Rows / Totals ⊆ auth()->user()->allowedBranchIds() ∩ requested_branch_ids
    //  Current runtime (what the assertions capture today):
    //   Any authenticated tenant user with `reports.view` can enumerate
    //   the whole tenant's purchase totals via `/api/reports/purchases`,
    //   with or without an explicit branch_id filter.
    // ═════════════════════════════════════════════════════════════════

    /**
     * @test — A2.1 CONFIRMED GAP.
     * No branch filter: a user restricted to MAIN sees purchases from every
     * branch — secure invariant would return only MAIN (100000 minor units).
     */
    public function purchase_report_without_branch_filter_leaks_forbidden_branches(): void
    {
        $this->postedPurchase($this->mainBranchId, 100000);
        $this->postedPurchase($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch();
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/purchases?view=period&interval=month')
            ->assertOk()->json();

        $totalMinor = 0;
        foreach ($report['data'] as $row) {
            $totalMinor += (int) round(((float) $row['amount']) * 100);
        }

        // GAP: forbidden branch's data (900000 hallahs) leaks into the total.
        // Secure invariant AFTER fix: $totalMinor === 100000.
        $this->assertSame(
            1000000,
            $totalMinor,
            'Characterization changed — PurchaseReport now scopes to allowedBranchIds. Update this test to the secure invariant.'
        );
    }

    /**
     * @test — A2.2 CONFIRMED GAP.
     * Explicit forbidden branch_id: the report honours a client-supplied
     * filter for a branch the user is not allowed to access. Secure
     * invariant would return zero rows / zero totals (intersection empty).
     */
    public function purchase_report_returns_data_when_client_requests_forbidden_branch(): void
    {
        $this->postedPurchase($this->mainBranchId, 100000);
        $this->postedPurchase($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('restricted-b@awj-rpt.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/purchases?view=period&interval=month&branch_id[]=' . $this->otherBranchId)
            ->assertOk()->json();

        $totalMinor = 0;
        foreach ($report['data'] as $row) {
            $totalMinor += (int) round(((float) $row['amount']) * 100);
        }

        // GAP: the forbidden branch's total is returned as-is.
        // Secure invariant AFTER fix: $totalMinor === 0.
        $this->assertSame(
            900000,
            $totalMinor,
            'Characterization changed — PurchaseReport now enforces allowedBranchIds intersection.'
        );
    }

    /**
     * @test — A2.3 Totals/rows are internally consistent (positive control).
     * Even under the current leak the two sums agree — meaning both are
     * leaking together. If totals and rows disagreed, the gap would be a
     * different (worse) shape than §26 describes.
     */
    public function purchase_report_totals_and_rows_agree_under_current_leak(): void
    {
        $this->postedPurchase($this->mainBranchId, 100000);
        $this->postedPurchase($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('restricted-t@awj-rpt.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/purchases?view=period&interval=month')
            ->assertOk()->json();

        $rowsMinor = 0;
        foreach ($report['data'] as $row) {
            $rowsMinor += (int) round(((float) $row['amount']) * 100);
        }
        $totalsMinor = (int) round(((float) $report['totals']['amount']) * 100);

        $this->assertSame($rowsMinor, $totalsMinor);
    }

    // ═════════════════════════════════════════════════════════════════
    //  A1 — Sales Report — CONFIRMED GAP.
    //
    //  Static evidence:
    //   - app/Services/Reporting/SalesReportService.php:62-83 → uses
    //     `Invoice::query()` (keeps BranchScope) but does NOT intersect
    //     `branch_id` filter with `User::allowedBranchIds()`.
    //   - SetBranch middleware (app/Http/Middleware/SetBranch.php:44-56)
    //     sets `BranchContext` from the request's `X-Branch-Id` header —
    //     when the header is absent, the middleware picks either the
    //     tenant's main branch (if allowed to the user) or the first of
    //     the user's allowed branches; there is NO branch context path
    //     that folds allowed branches into the query itself.
    //
    //  Runtime consequence: with no branch_id filter, BranchScope narrows
    //  results to the ACTIVE branch — the tenant main branch when the user
    //  is allowed there OR the header is set — which is broader than the
    //  user's real allow-set whenever the user's default branch is not the
    //  requested one. And an explicit `branch_id[]=forbidden` filter
    //  bypasses BranchScope by narrowing to that branch directly.
    // ═════════════════════════════════════════════════════════════════

    /**
     * @test — A1.1 CONFIRMED GAP.
     * With no branch filter, the sales report returns whichever branch the
     * SetBranch middleware settled on (the main branch here) — which
     * happens to include BOTH invoices because SetBranch has picked
     * `main_branch_id` from BranchSettings for the restricted user (they
     * are allowed there). Secure invariant would intersect with allowed
     * set FIRST and, since our restricted user is only allowed MAIN,
     * return only the 100000 minor-unit invoice.
     */
    public function sales_report_leaks_across_branches_via_branch_context_fallback(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('restricted-s@awj-rpt.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/sales?view=period&interval=month')
            ->assertOk()->json();

        $totalsMinor = (int) round(((float) $report['totals']['amount']) * 100);

        // Documented leak: returns 1_000_000 (both invoices) despite the
        // user being restricted to MAIN only. Secure invariant AFTER fix:
        // $totalsMinor === 100000.
        $this->assertSame(
            1000000,
            $totalsMinor,
            'SalesReport characterization changed — verify the new scope logic before updating this assertion.'
        );
    }

    /**
     * @test — A1.2 CONFIRMED GAP.
     * SalesReport accepts a client-supplied branch filter for a branch the
     * restricted user is not allowed to access.
     */
    public function sales_report_returns_forbidden_branch_when_client_requests_it(): void
    {
        $this->postedInvoice($this->mainBranchId, 100000);
        $this->postedInvoice($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('restricted-s2@awj-rpt.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/sales?view=period&interval=month&branch_id[]=' . $this->otherBranchId)
            ->assertOk()->json();

        $totalsMinor = (int) round(((float) $report['totals']['amount']) * 100);

        // GAP: forbidden branch's 900000 comes back verbatim.
        // Secure invariant AFTER fix: $totalsMinor === 0.
        $this->assertSame(
            900000,
            $totalsMinor,
            'SalesReport characterization changed — allowedBranchIds intersection may now be present.'
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  A3 — Inventory Report — CONFIRMED GAP.
    //
    //  Static evidence:
    //   - app/Services/Reporting/InventoryReportService.php:63 →
    //     `Product::query()->withoutGlobalScope(BranchScope::class)`.
    //   - :104 → `warehouseBalances` builds off `ProductWarehouseStock`
    //     directly with no user-warehouse intersection.
    //
    //  Users have a separate warehouse scope (`User::allowedWarehouseIds()`)
    //  and a branch scope. Neither is applied by InventoryReportService.
    // ═════════════════════════════════════════════════════════════════

    /**
     * @test — A3.1 CONFIRMED GAP.
     * A user restricted to MAIN sees warehouse balances from the
     * forbidden warehouse in the report. Secure invariant would filter
     * out the OTHER warehouse row entirely.
     */
    public function inventory_warehouses_report_leaks_forbidden_branch_warehouse(): void
    {
        $trackedProduct = $this->withToken($this->ownerToken)->postJson('/api/products', [
            'name' => 'صنف مخزون', 'sku' => 'INV-1', 'type' => 'good',
            'purchase_price' => 10000, 'sale_price' => 20000, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];

        // We insert stock rows directly because the concern here is scope,
        // not inventory posting mechanics. ProductWarehouseStock is the
        // exact table `warehouseBalances` reads.
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId,
            'product_id' => $trackedProduct,
            'warehouse_id' => $this->mainWarehouseId,
            'quantity' => 5,
        ]);
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId,
            'product_id' => $trackedProduct,
            'warehouse_id' => $this->otherWarehouseId,
            'quantity' => 7,
        ]);

        $restricted = $this->restrictedToMainBranch('restricted-inv@awj-rpt.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/inventory?view=warehouses')
            ->assertOk()->json();

        $warehousesSeen = collect($report['data'] ?? [])
            ->pluck('warehouse_id')
            ->filter()
            ->all();

        // GAP: the report enumerates BOTH warehouses despite the user's
        // branch restriction. Secure invariant AFTER fix: only MAIN.
        $this->assertContains($this->mainWarehouseId, $warehousesSeen);
        $this->assertContains(
            $this->otherWarehouseId,
            $warehousesSeen,
            'InventoryReport now scopes to allowed warehouses — update this test to the secure invariant.'
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  Tenant Negative Control.
    //  If Tenant A user resolves Tenant B branch IDs, every finding above
    //  is invalid. This must fail loudly, not silently degrade.
    // ═════════════════════════════════════════════════════════════════

    /** @test — NEG.1: cross-tenant branch_id filters must not return the other tenant's data. */
    public function cross_tenant_branch_id_never_returns_other_tenants_data(): void
    {
        $this->postedPurchase($this->mainBranchId, 100000);

        $other = $this->registerTenant('awj-rpt-nt', 'nt@awj-rpt.test');
        app(TenantContext::class)->set($other['tenant_id']);
        // Attempt Tenant B → filter on Tenant A branch:
        $report = $this->withToken($other['token'])
            ->getJson('/api/reports/purchases?view=period&interval=month&branch_id[]=' . $this->mainBranchId)
            ->assertOk()->json();

        $totalsMinor = (int) round(((float) $report['totals']['amount']) * 100);
        $this->assertSame(
            0,
            $totalsMinor,
            'CRITICAL — tenant isolation violation: cross-tenant branch_id returned data.'
        );
    }
}
