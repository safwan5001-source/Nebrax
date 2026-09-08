<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * Access Control V2 — Verification Matrix (executable evidence).
 *
 * Purpose: turn the static-analysis findings recorded in
 * docs/plans/access-control/AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md
 * into runtime evidence. Verification only — NO production changes and
 * NO fixes here. Each test's docblock names the claim, the classification
 * it produces, and the source line evidence supporting it.
 *
 * All financial tests must additionally assert that a failed authorization
 * leaves no partial side effect (no posted Payment, no journal entry, no
 * paid_amount drift). Rollback correctness is not the primary claim, but
 * assessing it here prevents fixing one gap by opening another.
 */
class AccessControlV2VerificationTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected Partner $supplier;
    protected PaymentService $payments;
    protected CashBankAccountService $cashBankAccounts;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'أَوْج التحقق',
            'slug' => 'awj-verify',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل التحقق', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد التحقق', 'type' => 'supplier']);
        $this->payments = app(PaymentService::class);
        $this->cashBankAccounts = app(CashBankAccountService::class);
    }

    // ─────────────────────────────────────────────────────────────────
    //  Helpers — restricted personas + treasury scoping.
    // ─────────────────────────────────────────────────────────────────

    protected function makeUser(string $role, string $email): User
    {
        return User::create([
            'tenant_id' => $this->tenant->id,
            'name' => "User {$role}",
            'email' => $email,
            'password' => 'password123',
            'role' => $role,
        ]);
    }

    protected function mainCash(): CashBankAccount
    {
        // resolveForPayment auto-bootstraps the default cash and bank rows;
        // borrow the same idempotent seeder to avoid touching production paths.
        $this->cashBankAccounts->bootstrapDefaults();

        return CashBankAccount::where('type', 'cash')->where('is_main', true)->firstOrFail();
    }

    protected function receivedPayment(?string $cashAccountId = null): Payment
    {
        return $this->payments->create([
            'partner_id' => $this->customer->id,
            'amount' => 100000,
            'direction' => 'received',
            'method' => 'cash',
            'cash_account_id' => $cashAccountId,
        ]);
    }

    protected function paidPayment(?string $cashAccountId = null): Payment
    {
        return $this->payments->create([
            'partner_id' => $this->supplier->id,
            'amount' => 100000,
            'direction' => 'paid',
            'method' => 'cash',
            'cash_account_id' => $cashAccountId,
        ]);
    }

    protected function assertNoPaymentSideEffects(Payment $payment): void
    {
        // Rollback correctness: a rejected post() must leave no journal and
        // must not flip status/paid_amount on the source Payment row.
        $this->assertDatabaseHas('payments', [
            'id' => $payment->id,
            'status' => 'draft',
        ]);
        $this->assertDatabaseMissing('journal_entries', [
            'source_type' => Payment::class,
            'source_id' => $payment->id,
        ]);
    }

    // ═════════════════════════════════════════════════════════════════
    //  GROUP C — PaymentService actor semantics (direct unit-style).
    //
    //  Reference: AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE §16.1
    //  and §17. `PaymentService::post(Payment, ?User $actor = null)` calls
    //  CashBankAccountService::assertAllowed(..., $actor). Evidence source:
    //    - app/Services/Accounting/PaymentService.php:244 (signature)
    //    - app/Services/Accounting/PaymentService.php:292 (assertAllowed call)
    //    - app/Models/CashBankAccount.php:47-59 (allows(): scope semantics)
    // ═════════════════════════════════════════════════════════════════

    /** @test — C.NULL.ALL: null actor passes on scope=all (documented). */
    public function null_actor_passes_treasury_acl_when_deposit_scope_is_all(): void
    {
        $cash = $this->mainCash();
        $cash->forceFill(['deposit_scope' => 'all', 'deposit_scope_subject' => null])->save();

        $payment = $this->receivedPayment();
        $posted = $this->payments->post($payment);

        $this->assertSame('posted', $posted->status);
    }

    /** @test — C.NULL.BRANCH: null actor passes on scope=branch when active branch matches. */
    public function null_actor_passes_treasury_acl_when_deposit_scope_is_branch_and_context_matches(): void
    {
        $cash = $this->mainCash();
        $branch = \App\Models\Branch::create([
            'tenant_id' => $this->tenant->id,
            'code' => 'ACL-BR-1',
            'name' => 'فرع فحص',
        ]);
        app(BranchContext::class)->set($branch->id);
        $cash->forceFill([
            'deposit_scope' => 'branch',
            'deposit_scope_subject' => $branch->id,
        ])->save();

        $payment = $this->receivedPayment();
        $posted = $this->payments->post($payment); // actor null on purpose

        $this->assertSame('posted', $posted->status);
    }

    /** @test — C.NULL.USER: null actor is REJECTED on scope=user, even if a matching authorized user exists.
     *  This is the failure mode that all null-actor call sites (POS/Fuel/Invoice/Purchase auto-settle)
     *  inherit at runtime under user-scoped CashBankAccounts. */
    public function null_actor_fails_treasury_acl_when_deposit_scope_is_user_even_for_authorized_user(): void
    {
        $authorized = $this->makeUser('cashier', 'authorized@awj-verify.test');
        $cash = $this->mainCash();
        $cash->forceFill([
            'deposit_scope' => 'user',
            'deposit_scope_subject' => $authorized->id,
        ])->save();

        $payment = $this->receivedPayment();

        try {
            $this->payments->post($payment); // NO actor passed — matches POS/Fuel/Invoice/Purchase pattern
            $this->fail('Expected RuntimeException from assertAllowed(deposit) but post() succeeded.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('صلاحية', $e->getMessage());
        }

        $this->assertNoPaymentSideEffects($payment);
    }

    /** @test — C.USER.MATCH: passing the authorized actor makes the same post succeed.
     *  This is the "correct" call shape used only by PaymentController::store() today. */
    public function passing_authorized_actor_succeeds_where_null_actor_would_fail(): void
    {
        $authorized = $this->makeUser('cashier', 'authorized2@awj-verify.test');
        $cash = $this->mainCash();
        $cash->forceFill([
            'deposit_scope' => 'user',
            'deposit_scope_subject' => $authorized->id,
        ])->save();

        $payment = $this->receivedPayment();
        $posted = $this->payments->post($payment, $authorized);

        $this->assertSame('posted', $posted->status);
    }

    /** @test — C.USER.WRONG: passing a non-subject user is rejected (positive control on user scope). */
    public function passing_a_different_actor_fails_user_scoped_treasury_acl(): void
    {
        $authorized = $this->makeUser('cashier', 'auth-c@awj-verify.test');
        $other = $this->makeUser('cashier', 'other-c@awj-verify.test');
        $cash = $this->mainCash();
        $cash->forceFill([
            'deposit_scope' => 'user',
            'deposit_scope_subject' => $authorized->id,
        ])->save();

        $payment = $this->receivedPayment();

        $this->expectException(RuntimeException::class);
        try {
            $this->payments->post($payment, $other);
        } finally {
            $this->assertNoPaymentSideEffects($payment);
        }
    }

    /** @test — C.NULL.ROLE: null actor is REJECTED on scope=role, even for a user carrying the subject role. */
    public function null_actor_fails_treasury_acl_when_deposit_scope_is_role(): void
    {
        $this->makeUser('cashier', 'r-cashier@awj-verify.test');
        $cash = $this->mainCash();
        $cash->forceFill([
            'deposit_scope' => 'role',
            'deposit_scope_subject' => 'cashier',
        ])->save();

        $payment = $this->receivedPayment();

        $this->expectException(RuntimeException::class);
        try {
            $this->payments->post($payment);
        } finally {
            $this->assertNoPaymentSideEffects($payment);
        }
    }

    /** @test — C.ROLE.MATCH: same operation succeeds when the actor carries the subject role. */
    public function role_matching_actor_passes_role_scoped_treasury_acl(): void
    {
        $actor = $this->makeUser('cashier', 'r-ok@awj-verify.test');
        $cash = $this->mainCash();
        $cash->forceFill([
            'deposit_scope' => 'role',
            'deposit_scope_subject' => 'cashier',
        ])->save();

        $payment = $this->receivedPayment();
        $posted = $this->payments->post($payment, $actor);

        $this->assertSame('posted', $posted->status);
    }

    /** @test — C.WITHDRAW.NULL: mirror check on the withdraw direction (paid direction). */
    public function null_actor_fails_treasury_acl_when_withdraw_scope_is_user(): void
    {
        $authorized = $this->makeUser('accountant', 'w-auth@awj-verify.test');
        $cash = $this->mainCash();
        $cash->forceFill([
            'withdraw_scope' => 'user',
            'withdraw_scope_subject' => $authorized->id,
        ])->save();

        $payment = $this->paidPayment();

        $this->expectException(RuntimeException::class);
        try {
            $this->payments->post($payment); // no actor
        } finally {
            $this->assertNoPaymentSideEffects($payment);
        }
    }

    // ═════════════════════════════════════════════════════════════════
    //  GROUP C — Composed-service actor loss (call-site evidence).
    //
    //  The service code below calls PaymentService::post($payment) with
    //  exactly one argument. Because §16.1 shows a null actor fails on
    //  user/role scopes but passes on all/branch, these call-sites
    //  cannot faithfully enforce configured treasury ACL semantics.
    //  We anchor the finding to line numbers via reflection so a future
    //  fix cannot silently regress this test.
    // ═════════════════════════════════════════════════════════════════

    protected function fileHasSingleArgPost(string $absolutePath): bool
    {
        $src = file_get_contents($absolutePath);
        // Match `$this->payments->post($X)` where $X does not contain a comma
        // at the top level. Simple heuristic: line contains `->payments->post(`
        // and the very next parenthesis level closes with `);` on the same or
        // next line without a top-level comma. We do a coarse regex — accurate
        // enough to distinguish `post($p)` from `post($p, $actor)`.
        if (! preg_match_all('/->payments->post\(([^;]+)\);/', $src, $matches)) {
            return false;
        }
        foreach ($matches[1] as $arglist) {
            // Strip nested parens for a simple top-level comma check.
            $depth = 0;
            $topLevelCommas = 0;
            for ($i = 0, $n = strlen($arglist); $i < $n; $i++) {
                $c = $arglist[$i];
                if ($c === '(') { $depth++; continue; }
                if ($c === ')') { $depth--; continue; }
                if ($c === ',' && $depth === 0) { $topLevelCommas++; }
            }
            if ($topLevelCommas === 0) {
                return true;
            }
        }

        return false;
    }

    /** @test — C1: POS checkout tender post call site — CONFIRMED actor omission.
     *  Source line: app/Services/Accounting/PosService.php:248 */
    public function pos_service_calls_payment_post_without_actor(): void
    {
        $this->assertTrue(
            $this->fileHasSingleArgPost(app_path('Services/Accounting/PosService.php')),
            'PosService no longer omits actor at PaymentService::post() — regression against §17.1 findings; update the reference before touching this test.'
        );
    }

    /** @test — C2: Fuel sale collection post call site — CONFIRMED actor omission.
     *  Source line: app/Services/FuelSaleService.php:330 */
    public function fuel_sale_service_calls_payment_post_without_actor(): void
    {
        $this->assertTrue(
            $this->fileHasSingleArgPost(app_path('Services/FuelSaleService.php')),
            'FuelSaleService no longer omits actor at PaymentService::post() — regression against §17.2.'
        );
    }

    /** @test — C3: InvoiceService settle() post call site — CONFIRMED omission.
     *  Source line: app/Services/Accounting/InvoiceService.php:1052 */
    public function invoice_service_settle_calls_payment_post_without_actor(): void
    {
        $this->assertTrue(
            $this->fileHasSingleArgPost(app_path('Services/Accounting/InvoiceService.php')),
            'InvoiceService no longer omits actor at PaymentService::post() — regression against §17.3.'
        );
    }

    /** @test — C4: PurchaseService settle() post call site — CONFIRMED omission.
     *  Source line: app/Services/Accounting/PurchaseService.php:563 */
    public function purchase_service_settle_calls_payment_post_without_actor(): void
    {
        $this->assertTrue(
            $this->fileHasSingleArgPost(app_path('Services/Accounting/PurchaseService.php')),
            'PurchaseService no longer omits actor at PaymentService::post() — regression against §17.4.'
        );
    }

    /** @test — C.BASELINE: PaymentController — GOOD baseline reference from §16.2. */
    public function payment_controller_passes_authenticated_actor_to_payment_service_post(): void
    {
        $src = file_get_contents(app_path('Http/Controllers/Api/PaymentController.php'));
        // Baseline reference — actor is propagated.
        $this->assertMatchesRegularExpression(
            '/\$this->payments->post\([^,;]+,\s*\$request->user\(\)\)/',
            $src,
            'PaymentController lost the actor propagation baseline — the reference-good path in §16.2 is regressed.'
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  GROUP D — Direct cash sale bypasses CashBankAccountService.
    //
    //  Reference §18.3 candidate. Source lines:
    //    - app/Services/Accounting/InvoiceService.php:44 (const ACC_CASH='1110')
    //    - app/Services/Accounting/InvoiceService.php:863 (payment_type=='cash'
    //        -> $this->accountId(self::ACC_CASH))
    //  The invoice's own journal entry debits 1110 directly, without ever
    //  calling CashBankAccountService::assertAllowed(). A user with any
    //  invoice-post authority effects the cash account regardless of deposit
    //  ACL configured on the tenant's default cash CashBankAccount.
    // ═════════════════════════════════════════════════════════════════

    /** @test — D1: Direct cash-sale posts a debit to 1110 without traversing CashBankAccountService. */
    public function direct_cash_sale_debits_cash_account_without_cashbank_acl(): void
    {
        $invoices = app(InvoiceService::class);

        // Configure the tenant's cash CashBankAccount to explicitly forbid
        // this actor's deposits — a user-scoped subject pointing elsewhere.
        $stranger = $this->makeUser('cashier', 'stranger@awj-verify.test');
        $cash = $this->mainCash();
        $cash->forceFill([
            'deposit_scope' => 'user',
            'deposit_scope_subject' => $stranger->id,
        ])->save();

        // Post a cash invoice through InvoiceService (its own journal path).
        $invoice = $invoices->create([
            'partner_id' => $this->customer->id,
            'payment_type' => 'cash',
            'invoice_date' => '2026-02-10',
        ], [[
            'description' => 'بيع نقدي مباشر',
            'quantity' => 1,
            'unit_price' => 100000,
            'tax_rate' => 0,
        ]]);
        $posted = $invoices->post($invoice);

        // Evidence: the invoice journal entry debits 1110 (ACC_CASH constant),
        // and no CashBank ACL rejected the operation.
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', \App\Models\Invoice::class)
            ->where('source_id', $posted->id)
            ->firstOrFail();

        $debitsCash = $entry->lines->contains(
            fn (JournalLine $l) => $l->account->code === '1110' && (int) $l->debit > 0
        );

        $this->assertTrue(
            $debitsCash,
            'Direct cash sale should debit 1110 by design — if this changed, revisit the §18.3 candidate finding.'
        );

        // Sanity check: no ACL denial was raised despite the deposit_scope
        // pointing to a stranger — CashBankAccountService was not consulted.
        $this->assertSame('posted', $posted->status);
    }

    // ═════════════════════════════════════════════════════════════════
    //  GROUP E — POS variance settlement bypasses CashBank ACL (policy).
    //
    //  Reference §18.2 policy ambiguity. Source lines:
    //    - app/Services/Accounting/PosSessionService.php:600 (settleVariance)
    //    - app/Services/Accounting/PosSessionService.php:623 (sessionCashAccountId)
    //  settleVariance never calls assertAllowed(). If treasury ACL is meant
    //  to be an absolute resource boundary, this is a gap; if pos.variance.approve
    //  is a domain override, the exception must be explicit. We record the
    //  CURRENT behavior via inspection here, since the policy is a decision
    //  to make, not a bug to fix.
    // ═════════════════════════════════════════════════════════════════

    /** @test — E1: settleVariance does not consult CashBankAccountService (policy decision required). */
    public function pos_variance_settlement_does_not_check_cashbank_acl(): void
    {
        $src = file_get_contents(app_path('Services/Accounting/PosSessionService.php'));

        // Locate the settleVariance method body and confirm it contains no
        // assertAllowed call. This is deliberate policy today per §18.2.
        $this->assertMatchesRegularExpression('/function\s+settleVariance\s*\(/', $src);
        $start = strpos($src, 'function settleVariance');
        // Take a generous slice — settleVariance is <120 lines.
        $body = substr($src, $start, 6000);
        $this->assertStringNotContainsString(
            'assertAllowed',
            $body,
            'settleVariance now calls assertAllowed — the §18.2 policy ambiguity was resolved without updating the reference.'
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  GROUP F — Existing good treasury paths (regression control).
    //  Confirms PaymentController still receives the authenticated actor.
    // ═════════════════════════════════════════════════════════════════

    /** @test — F1: cash/bank transfer service checks both sides.
     *  Source: CashBankTransferService — §16.3 reference. */
    public function cash_bank_transfer_service_still_checks_both_sides(): void
    {
        $src = file_get_contents(app_path('Services/Accounting/CashBankTransferService.php'));
        $withdrawCount = substr_count($src, "assertAllowed");
        $this->assertGreaterThanOrEqual(
            2,
            $withdrawCount,
            'CashBankTransferService lost one of its two assertAllowed checks — §16.3 regression.'
        );
    }

    /** @test — F2: EmployeeCustodyService still checks withdraw before posting.
     *  Source: §16.4 reference. */
    public function employee_custody_service_still_checks_withdraw(): void
    {
        $src = file_get_contents(app_path('Services/Accounting/EmployeeCustodyService.php'));
        $this->assertStringContainsString('assertAllowed', $src);
    }

    /** @test — F3: SupplierRefundService still checks deposit before posting.
     *  Source: §16.5 reference. */
    public function supplier_refund_service_still_checks_deposit(): void
    {
        $src = file_get_contents(app_path('Services/Accounting/SupplierRefundService.php'));
        $this->assertStringContainsString('assertAllowed', $src);
    }
}
