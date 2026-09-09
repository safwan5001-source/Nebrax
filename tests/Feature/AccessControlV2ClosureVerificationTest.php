<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Purchase;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use ReflectionClass;
use Tests\TestCase;

/**
 * Access Control V2 — Verification Closure.
 *
 * Purpose: close every remaining "DEFERRED / UNKNOWN" item from
 * docs/plans/access-control/AWJ_ACCESS_CONTROL_V2_VERIFICATION_REPORT.md
 * with executable evidence, so the verification round is complete before
 * any production fix PR is opened.
 *
 * Groups covered here:
 *  - B  Report Exports (Sales / Purchases / Inventory / Customer / Classification)
 *  - Customer Report runtime verification
 *  - Classification Analytics runtime verification
 *  - Invoice is_paid=true reachability into InvoiceService::settle()
 *  - Purchase paid_on_post reachability into PurchaseService::settle()
 *
 * Discipline: verification tests only. NO production code touched here.
 */
class AccessControlV2ClosureVerificationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected string $ownerToken;
    protected string $tenantId;
    protected string $mainBranchId;
    protected string $otherBranchId;
    protected string $supplierId;
    protected string $customerId;
    protected string $productId;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('awj-close', 'owner@awj-close.test');
        $this->ownerToken = $auth['token'];
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);

        $this->mainBranchId = $this->withToken($this->ownerToken)
            ->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $this->otherBranchId = $this->withToken($this->ownerToken)
            ->postJson('/api/branches', ['name' => 'فرع محظور', 'code' => 'FRB-CLOSE'])
            ->assertCreated()['data']['id'];

        $this->supplierId = $this->withToken($this->ownerToken)
            ->postJson('/api/partners', ['name' => 'مورد إغلاق', 'type' => 'supplier'])
            ->assertCreated()['data']['id'];
        $this->customerId = $this->withToken($this->ownerToken)
            ->postJson('/api/partners', ['name' => 'عميل إغلاق', 'type' => 'customer'])
            ->assertCreated()['data']['id'];

        $this->productId = $this->withToken($this->ownerToken)->postJson('/api/products', [
            'name' => 'صنف إغلاق', 'sku' => 'CLOSE-1', 'type' => 'good',
            'purchase_price' => 10000, 'sale_price' => 20000, 'track_inventory' => false,
        ])->assertCreated()['data']['id'];
    }

    protected function restrictedToMainBranch(string $email): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $user = User::create([
            'tenant_id' => $this->tenantId,
            'name' => 'موظف مقيّد إغلاق',
            'email' => $email,
            'password' => 'password123',
            'role' => 'admin',
        ]);
        $user->branches()->sync([$this->mainBranchId]);

        return $user->createToken('api')->plainTextToken;
    }

    protected function postedInvoiceInBranch(string $branchId, int $amount): string
    {
        $invoice = $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson('/api/invoices', [
                'partner_id' => $this->customerId,
                'payment_type' => 'credit',
                'invoice_date' => '2026-02-10',
                'items' => [[
                    'product_id' => $this->productId,
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

    protected function postedPurchaseInBranch(string $branchId, int $amount): string
    {
        $purchase = $this->withToken($this->ownerToken)
            ->withHeader('X-Branch-Id', $branchId)
            ->postJson('/api/purchases', [
                'partner_id' => $this->supplierId,
                'payment_type' => 'credit',
                'purchase_date' => '2026-02-10',
                'items' => [[
                    'product_id' => $this->productId,
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

    // ═════════════════════════════════════════════════════════════════
    //  GROUP B — Report Exports.
    //
    //  Architecture check: the five report controllers
    //  (SalesReport / PurchaseReport / InventoryReport / CustomerReport /
    //  ClassificationAnalyticsReport) expose ONLY a `show()` JsonResponse
    //  method. There is NO server-side CSV/XLSX/PDF export endpoint on
    //  the report family. The web/ workspace does its own client-side
    //  CSV/PDF rendering (see web/src/components/reports/*-workspace.tsx
    //  using @/lib/export + @/modules/reports/services/report-pdf).
    //
    //  Consequence: report export scope = report API JSON scope. Every
    //  gap already confirmed on the JSON API is inherited by the export
    //  by construction. No additional server-side export test can be
    //  written for these reports because there is no additional server
    //  surface.
    //
    //  There is ONE unrelated server export: `GET /api/inventory/export`
    //  in InventoryController — that is a CATALOG balance export on
    //  `Product::query()` (aggregate quantity_on_hand + avg_cost per
    //  product), not the InventoryReport export. It is verified below
    //  for its own scope shape.
    // ═════════════════════════════════════════════════════════════════

    /** @test — B.1: no server-side export/download method on the 5 report controllers. */
    public function report_controllers_have_no_server_side_export_methods(): void
    {
        $controllers = [
            \App\Http\Controllers\Api\SalesReportController::class,
            \App\Http\Controllers\Api\PurchaseReportController::class,
            \App\Http\Controllers\Api\InventoryReportController::class,
            \App\Http\Controllers\Api\CustomerReportController::class,
            \App\Http\Controllers\Api\ClassificationAnalyticsReportController::class,
        ];

        $forbidden = ['export', 'download', 'csv', 'xlsx', 'pdf', 'print'];

        foreach ($controllers as $class) {
            $ref = new ReflectionClass($class);
            foreach ($ref->getMethods(\ReflectionMethod::IS_PUBLIC) as $method) {
                if ($method->getDeclaringClass()->getName() !== $class) {
                    continue; // ignore inherited framework methods
                }
                foreach ($forbidden as $keyword) {
                    $this->assertStringNotContainsStringIgnoringCase(
                        $keyword,
                        $method->getName(),
                        "A new server-side {$keyword} method appeared on {$class}::{$method->getName()}. The verification closure assumed no such surface — extend the export verification tests to cover it."
                    );
                }
            }
        }
    }

    /**
     * @test — B.2 (report exports).
     * Web export pipeline is 100% client-side — a fact anchored here by
     * reading the exact modules the workspace files import. If either
     * import is renamed or moved, this test fires and the reviewer must
     * confirm the client-side-only assumption still holds.
     */
    public function web_reports_workspaces_still_use_client_side_export_helpers(): void
    {
        $workspaces = [
            base_path('../Nebrax/web/src/components/reports/reports-workspace.tsx'),
            base_path('../Nebrax/web/src/components/reports/purchases-reports-workspace.tsx'),
        ];

        // The web/ tree is not always present when tests run against the
        // packaged nibras-app copy. Skip cleanly if either file is missing —
        // this is an architecture anchor, not a source-of-truth check.
        foreach ($workspaces as $file) {
            if (! is_file($file)) {
                $this->markTestSkipped('web/ tree not present in this test build; architecture anchor skipped.');
            }
            $src = file_get_contents($file);
            $this->assertStringContainsString('@/lib/export', $src);
            $this->assertStringContainsString('@/modules/reports/services/report-pdf', $src);
        }
    }

    /**
     * @test — B.3: `/api/inventory/export` (catalog balances) is tenant-wide.
     *
     * Static evidence:
     *   - app/Support/InventoryBalanceFilters.php:57-59 → `Product::query()`
     *     tenant-scoped only, no branch/warehouse intersection.
     *   - app/Http/Controllers/Api/InventoryController.php:57-85 → export
     *     path invokes those filters + `InventoryBalanceExportService`.
     *
     * Runtime: a user restricted to Branch A receives XLSX/CSV that
     * contains the tenant's total quantity_on_hand across all warehouses,
     * because Product balances are stored as scalars on the Product row
     * (aggregate across warehouses). This is a REPORT-SHAPED aggregate,
     * so per §26 of the reference the warehouse-restricted user leaks
     * value information about warehouses they cannot access — through
     * the aggregate, not row-per-warehouse.
     */
    public function inventory_catalog_export_is_tenant_wide_and_not_warehouse_scoped(): void
    {
        // Seed a tracked product with quantity via API. We use the
        // inventory opening flow to legitimately raise quantity_on_hand.
        $product = $this->withToken($this->ownerToken)->postJson('/api/products', [
            'name' => 'صنف تصدير كتالوج',
            'sku' => 'EXP-CAT-1',
            'type' => 'good',
            'purchase_price' => 10000,
            'sale_price' => 20000,
            'track_inventory' => true,
        ])->assertCreated()['data'];

        // Direct DB write on Product.quantity_on_hand simulates what
        // opening + stock ops eventually leave on the row. This does not
        // change production behavior; it only positions data for the
        // export scope test.
        \App\Models\Product::whereKey($product['id'])
            ->update(['quantity_on_hand' => 99, 'avg_cost' => 10000]);

        $restricted = $this->restrictedToMainBranch('inv-cat-export@awj-close.test');

        $response = $this->withToken($restricted)
            ->getJson('/api/inventory/export?scope=filtered&format=csv&locale=en');
        $response->assertOk();
        $body = $response->streamedContent();

        $this->assertStringContainsString(
            'EXP-CAT-1',
            $body,
            'CONFIRMED GAP: /api/inventory/export returns the tenant-wide catalog balance to a branch-restricted user with no warehouse intersection. Secure invariant AFTER fix: aggregate must be scoped to allowed warehouses, or the endpoint must return a per-warehouse breakdown filtered by allowed warehouses.'
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  Customer Report — CONFIRMED GAP (P1) via runtime.
    //
    //  Source: app/Services/Reporting/CustomerReportService.php:66,149,198
    //     → withoutGlobalScope(BranchScope::class) on invoices/payments/appointments
    //     with no allowedBranchIds intersection.
    // ═════════════════════════════════════════════════════════════════

    /** @test — CUST.1: no branch filter leaks forbidden branches into customer sales roll-up. */
    public function customer_report_sales_view_leaks_across_branches_without_filter(): void
    {
        $this->postedInvoiceInBranch($this->mainBranchId, 100000);
        $this->postedInvoiceInBranch($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('cust1@awj-close.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/customers?view=sales')
            ->assertOk()->json();

        $totalsMinor = (int) round(((float) $report['totals']['amount']) * 100);

        // GAP: 1_000_000 = MAIN(100k) + FORBIDDEN(900k).
        // Secure invariant AFTER fix: === 100000.
        $this->assertSame(
            1000000,
            $totalsMinor,
            'CustomerReport characterization changed — allowedBranchIds intersection may now be present. Update this test to the secure invariant.'
        );
    }

    /** @test — CUST.2: explicit forbidden branch_id filter returns the forbidden branch's data. */
    public function customer_report_returns_forbidden_branch_when_client_requests_it(): void
    {
        $this->postedInvoiceInBranch($this->mainBranchId, 100000);
        $this->postedInvoiceInBranch($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('cust2@awj-close.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/customers?view=sales&branch_id[]=' . $this->otherBranchId)
            ->assertOk()->json();

        $totalsMinor = (int) round(((float) $report['totals']['amount']) * 100);

        $this->assertSame(
            900000,
            $totalsMinor,
            'CustomerReport now rejects/ignores forbidden branch_id filters — update the test to the secure invariant.'
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  Classification Analytics — CONFIRMED GAP (P1) via runtime.
    //
    //  Source: app/Services/Reporting/ClassificationAnalyticsReportService.php
    //     :53-56  sales_invoice / purchase_invoice → withoutGlobalScope
    //     :73-77  receipt / payment                → withoutGlobalScope
    //     :100    customer / supplier              → withoutGlobalScope
    //  All six scopes flow through documents()/payments()/partners(), each
    //  of which uses the same pattern. We test sales_invoice as the
    //  representative and add a source-shape check confirming the other
    //  five scopes route through the same three helpers.
    // ═════════════════════════════════════════════════════════════════

    /** @test — CLAS.1: sales_invoice scope leaks forbidden branch. */
    public function classification_analytics_sales_invoice_leaks_across_branches(): void
    {
        $this->postedInvoiceInBranch($this->mainBranchId, 100000);
        $this->postedInvoiceInBranch($this->otherBranchId, 900000);

        $restricted = $this->restrictedToMainBranch('clas1@awj-close.test');
        $report = $this->withToken($restricted)
            ->getJson('/api/reports/classification-analytics?scope=sales_invoice')
            ->assertOk()->json();

        $totalMinor = 0;
        foreach ($report['data'] ?? $report['rows'] ?? [] as $row) {
            $amt = $row['amount'] ?? 0;
            $totalMinor += is_numeric($amt) && str_contains((string) $amt, '.')
                ? (int) round(((float) $amt) * 100)
                : (int) $amt;
        }

        $this->assertSame(
            1000000,
            $totalMinor,
            'ClassificationAnalytics sales_invoice scope: forbidden branch total leaked into aggregate. Secure invariant AFTER fix: === 100000.'
        );
    }

    /** @test — CLAS.2: purchase_invoice scope shares the leaking helper. */
    public function classification_analytics_purchase_invoice_scope_uses_same_leaking_helper(): void
    {
        // Source-shape assertion (not a runtime call): documents() +
        // payments() + partners() each carry a `withoutGlobalScope(BranchScope::class)`.
        $src = file_get_contents(app_path('Services/Reporting/ClassificationAnalyticsReportService.php'));
        $withoutScopeCount = substr_count($src, 'withoutGlobalScope(BranchScope::class)');

        $this->assertGreaterThanOrEqual(
            3,
            $withoutScopeCount,
            'ClassificationAnalytics no longer strips BranchScope in all three helper flavours — confirm which scopes stopped leaking before updating this test.'
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  Invoice `is_paid=true` reachability — settle() actor propagation
    //  upgrades from P2 → P1 once we prove the route is user-controllable.
    //
    //  Source:
    //   - app/Http/Requests/StoreInvoiceRequest.php:30 → is_paid is a
    //     user-controlled nullable boolean.
    //   - app/Services/Accounting/InvoiceService.php:985 → post() runs
    //     settle() with the invoice total.
    //   - InvoiceService.php:1052 → settle() calls PaymentService::post()
    //     without an actor.
    //
    //  Runtime: create a cash-paid invoice as a user who IS the authorized
    //  subject of the cash account's deposit_scope=user. The user IS
    //  authorized, but because settle() loses the actor, PaymentService
    //  rejects the deposit — proving the reachability of the null-actor
    //  gap. The invoice post fails atomically (no journal, no payment).
    // ═════════════════════════════════════════════════════════════════

    /** @test — REACH.INV.1: is_paid=true reaches settle(), which loses the actor. */
    public function invoice_is_paid_true_reaches_settle_and_null_actor_denies_authorized_user(): void
    {
        // 1. Bootstrap the tenant's default cash CashBankAccount.
        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = CashBankAccount::where('type', 'cash')->where('is_main', true)->firstOrFail();

        // 2. Register the restricted user and put them AS the deposit subject
        //    on the tenant's cash account — so they are the authorized user.
        $actor = User::create([
            'tenant_id' => $this->tenantId,
            'name' => 'كاشير مقيّد',
            'email' => 'reach-inv@awj-close.test',
            'password' => 'password123',
            'role' => 'admin',
        ]);
        $actor->branches()->sync([$this->mainBranchId]);
        $cash->forceFill([
            'deposit_scope' => 'user',
            'deposit_scope_subject' => $actor->id,
        ])->save();

        $token = $actor->createToken('api')->plainTextToken;

        // 3. POST /api/invoices with is_paid=true → auto-settle path.
        $created = $this->withToken($token)
            ->withHeader('X-Branch-Id', $this->mainBranchId)
            ->postJson('/api/invoices', [
                'partner_id' => $this->customerId,
                'payment_type' => 'credit',
                'invoice_date' => '2026-02-10',
                'is_paid' => true,
                'payment_method' => 'cash',
                'items' => [[
                    'product_id' => $this->productId,
                    'quantity' => 1,
                    'unit_price' => 100000,
                    'tax_rate' => 0,
                ]],
            ]);

        // Draft creation itself should succeed — settle() is invoked on post, not on create.
        if ($created->status() !== 201) {
            $this->fail("Invoice draft creation failed unexpectedly ({$created->status()}): " . $created->getContent());
        }
        $invoice = $created->json()['data'];

        // 4. POST /api/invoices/{id}/post → InvoiceService::post → settle → PaymentService::post(null actor).
        $posted = $this->withToken($token)
            ->withHeader('X-Branch-Id', $this->mainBranchId)
            ->postJson("/api/invoices/{$invoice['id']}/post");

        // 5. CONFIRMED REACHABLE GAP:
        //    - The user IS the authorized deposit subject → invoice should post cleanly.
        //    - But settle() calls PaymentService::post() without $actor,
        //      so CashBankAccountService::assertAllowed('deposit', null) rejects.
        //    - Laravel wraps the RuntimeException as 500 (JSON contract).
        $this->assertContains(
            $posted->status(),
            [409, 422, 500],
            "REACH.INV.1: is_paid=true auto-settle succeeded for the authorized user — either the actor is now propagated OR the deposit ACL semantics changed. Update this test to the secure invariant."
        );

        // 6. Atomicity: invoice stays in draft, no journal entry, no posted payment.
        $inv = Invoice::withoutGlobalScope(\App\Tenancy\BranchScope::class)
            ->findOrFail($invoice['id']);
        $this->assertNotSame('posted', $inv->status);
        $this->assertSame(
            0,
            Payment::withoutGlobalScope(\App\Tenancy\BranchScope::class)
                ->where('invoice_id', $invoice['id'])
                ->where('status', 'posted')
                ->count(),
            'A posted Payment leaked out of a rejected is_paid=true settle() — atomicity is broken.'
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  Purchase `paid_on_post` reachability — mirror of Invoice above.
    //
    //  Source:
    //   - app/Http/Requests/StorePurchaseRequest.php:36 → paid_on_post
    //     is a user-controlled nullable integer.
    //   - app/Services/Accounting/PurchaseService.php:526 → post() runs
    //     settle().
    //   - PurchaseService.php:563 → settle() calls PaymentService::post()
    //     without an actor.
    //
    //  Runtime: create a purchase with paid_on_post > 0 as a user who
    //  IS the authorized subject of the cash account's withdraw_scope=user.
    // ═════════════════════════════════════════════════════════════════

    /** @test — REACH.PUR.1: paid_on_post reaches settle(), which loses the actor. */
    public function purchase_paid_on_post_reaches_settle_and_null_actor_denies_authorized_user(): void
    {
        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = CashBankAccount::where('type', 'cash')->where('is_main', true)->firstOrFail();

        $actor = User::create([
            'tenant_id' => $this->tenantId,
            'name' => 'محاسب مقيّد',
            'email' => 'reach-pur@awj-close.test',
            'password' => 'password123',
            'role' => 'admin',
        ]);
        $actor->branches()->sync([$this->mainBranchId]);
        $cash->forceFill([
            'withdraw_scope' => 'user',
            'withdraw_scope_subject' => $actor->id,
        ])->save();

        $token = $actor->createToken('api')->plainTextToken;

        $created = $this->withToken($token)
            ->withHeader('X-Branch-Id', $this->mainBranchId)
            ->postJson('/api/purchases', [
                'partner_id' => $this->supplierId,
                'payment_type' => 'credit',
                'purchase_date' => '2026-02-10',
                'paid_on_post' => 50000,
                'payment_method' => 'cash',
                'items' => [[
                    'product_id' => $this->productId,
                    'quantity' => 1,
                    'unit_price' => 100000,
                    'tax_rate' => 0,
                ]],
            ]);

        if ($created->status() !== 201) {
            $this->fail("Purchase draft creation failed unexpectedly ({$created->status()}): " . $created->getContent());
        }
        $purchase = $created->json()['data'];

        $posted = $this->withToken($token)
            ->withHeader('X-Branch-Id', $this->mainBranchId)
            ->postJson("/api/purchases/{$purchase['id']}/post");

        $this->assertContains(
            $posted->status(),
            [409, 422, 500],
            "REACH.PUR.1: paid_on_post auto-settle succeeded for the authorized user — either the actor is now propagated OR the withdraw ACL semantics changed."
        );

        // Atomicity: purchase stays in draft, no posted payment.
        $pur = Purchase::withoutGlobalScope(\App\Tenancy\BranchScope::class)
            ->findOrFail($purchase['id']);
        $this->assertNotSame('posted', $pur->status);
        $this->assertSame(
            0,
            Payment::withoutGlobalScope(\App\Tenancy\BranchScope::class)
                ->where('purchase_id', $purchase['id'])
                ->where('status', 'posted')
                ->count(),
            'A posted Payment leaked out of a rejected paid_on_post settle() — atomicity is broken.'
        );
    }
}
