<?php

namespace Tests\Feature;

use App\Events\PaymentRefundConfirmed;
use App\Models\PaymentConnectionEvent;
use App\Services\PaymentGatewayService;
use App\Support\PaymentGatewayException;
use App\Models\AccountRoleMapping;
use App\Models\PaymentGatewayAdjustment;
use App\Models\PaymentGatewayAdjustmentEvent;
use App\Services\PaymentGatewayAdjustmentService;
use App\Support\GatewayAdjustmentException;
use RuntimeException;
use App\Models\CreditNote;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Models\PaymentGatewaySettlementLine;
use App\Models\PaymentRefund;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\CustomerRefundService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentRefundPostingService;
use App\Services\PaymentRefundService;
use App\Services\PaymentsRolloutControlService;
use App\Support\SchedulerHeartbeat;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

use App\Models\Account;
use App\Models\Branch;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PaymentClearingReportService;

/**
 * PAY-H3-03 (الحد الأساسي) — مطابقة المقاصة 1170 بالقيود الفعلية، كشف فروقات التسويات، وأعمار الأرصدة حسب الفرع. قراءة فقط.
 */
class PaymentClearingReportTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $admin;

    private string $ownerToken;

    private Partner $customer;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private PlatformAdministrator $platform;

    private PaymentGatewaySettlementService $settlements;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->tenant = Tenant::create(['name' => 'شركة H3-03', 'slug' => 'pay-h3-03', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('sales', ['allow_standalone_credit_notes' => true], $this->tenant);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h3-03.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المدير', 'email' => 'admin@pay-h3-03.test', 'password' => 'password123', 'role' => 'admin']);
        $this->ownerToken = $this->owner->createToken('t')->plainTextToken;
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->platform = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h3-03.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, true, 'تفعيل للاختبار');
        $this->settlements = app(PaymentGatewaySettlementService::class);
    }


    #[Test]
    public function an_empty_tenant_reconciles_to_zero(): void
    {
        $report = app(PaymentClearingReportService::class)->reconcile();

        $this->assertSame('reconciled', $report['status']);
        $this->assertSame(0, $report['ledger_balance']);
        $this->assertSame(0, $report['expected_balance']);
        $this->assertSame('1170', $report['accounts'][0]['code']);
    }

    #[Test]
    public function the_clearing_account_matches_documents_through_capture_refund_and_settlement(): void
    {
        [$attempt, $paymentId] = $this->capture();
        $r = app(PaymentClearingReportService::class)->reconcile();
        $this->assertSame(115000, $r['ledger_balance']);
        $this->assertSame(115000, $r['expected_balance']);
        $this->assertSame('reconciled', $r['status']);

        $refund = $this->postedRefund($attempt, 20000);
        $r = app(PaymentClearingReportService::class)->reconcile();
        $this->assertSame(95000, $r['ledger_balance']);
        $this->assertSame(95000, $r['expected_balance']);
        $this->assertSame(20000, $r['documents']['unsettled_refunds']);

        // تسوية جزئية: 50000 من التحصيل بلا استرداد ⇒ المتبقي 65000 تحصيل و20000 استرداد
        $this->settlements->record($this->input($paymentId, 50000, [], net: 48000, fee: 2000, ref: 'PARTIAL'));
        $r = app(PaymentClearingReportService::class)->reconcile();
        $this->assertSame(45000, $r['ledger_balance']);
        $this->assertSame(45000, $r['expected_balance']);
        $this->assertSame('reconciled', $r['status']);

        // تسوية الباقي مع خصم الاسترداد ⇒ المقاصة صفر
        $this->settlements->record($this->input($paymentId, 65000, [$refund->id => 20000], net: 43000, fee: 2000, ref: 'REST'));
        $r = app(PaymentClearingReportService::class)->reconcile();
        $this->assertSame(0, $r['ledger_balance']);
        $this->assertSame(0, $r['expected_balance']);
        $this->assertSame('reconciled', $r['status']);
        $this->assertSame([0, 0, 0, 0], array_column($r['checks'], 'difference'));
        $this->assertSame(0, $r['per_gateway'][0]['expected_balance']);
    }

    #[Test]
    public function a_manual_entry_on_the_clearing_account_is_exposed_not_hidden_and_its_reversal_clears_it(): void
    {
        $this->capture();
        $clearing = Account::query()->where('code', '1170')->firstOrFail();
        $capital = Account::query()->where('code', '3110')->firstOrFail();
        $entry = app(LedgerService::class)->post([
            ['account_id' => $clearing->id, 'debit' => 7000],
            ['account_id' => $capital->id, 'credit' => 7000],
        ], ['entry_date' => '2026-10-23', 'description' => 'قيد يدوي على المقاصة']);

        $r = app(PaymentClearingReportService::class)->reconcile();
        $this->assertSame('difference', $r['status']);
        $this->assertSame(7000, $r['difference']);
        $other = collect($r['checks'])->firstWhere('key', 'other');
        $this->assertSame(7000, $other['difference']);
        $this->assertNotEmpty($r['other_sources']);

        app(LedgerService::class)->reverse($entry, '2026-10-23', 'تصحيح');
        $r = app(PaymentClearingReportService::class)->reconcile();
        $this->assertSame('reconciled', $r['status'], 'العكس ينسب إلى أصله فيتعادل');
        $this->assertSame(0, $r['difference']);
        $this->assertSame([], $r['other_sources'], 'قيد يدوي وعكسه صافيهما صفر ⇒ لا تحذير');
    }

    #[Test]
    public function unreconciled_settlements_are_listed_with_signed_differences_and_age(): void
    {
        [, $first] = $this->capture();
        [, $second] = $this->capture();
        // صافٍ أقل من المتوقع بـ500 ثم أكثر بـ300
        $a = $this->settlements->record($this->input($first, 115000, [], net: 110500, fee: 4000, ref: 'DIFF-A'));
        $b = $this->settlements->record($this->input($second, 115000, [], net: 111300, fee: 4000, ref: 'DIFF-B'));
        $this->assertSame('unreconciled', $a->status);
        $this->assertSame('unreconciled', $b->status);
        DB::table('payment_gateway_settlements')->where('id', $a->id)->update(['settlement_date' => '2026-10-13']);

        $report = app(PaymentClearingReportService::class)->differences();

        $this->assertSame(2, $report['totals']['count']);
        $this->assertSame((int) $a->unreconciled_minor + (int) $b->unreconciled_minor, $report['totals']['net_minor']);
        $this->assertSame($report['totals']['net_minor'], $report['totals']['positive_minor'] + $report['totals']['negative_minor']);
        $this->assertNotSame(0, $report['totals']['positive_minor']);
        $this->assertNotSame(0, $report['totals']['negative_minor']);
        $this->assertSame('2026-10-13', $report['totals']['oldest_settlement_date']);
        $this->assertSame('DIFF-A', $report['rows'][0]['provider_settlement_ref']);
        $this->assertSame(10, $report['rows'][0]['age_days']);
        $this->assertFalse($report['has_more']);
        $this->assertSame(0, app(PaymentClearingReportService::class)->differences((string) Str::uuid())['totals']['count']);

        // مرحَّلة ⇒ تخرج من الكشف
        $this->settlements->record($this->input($first, 115000, [], net: 111000, fee: 4000, ref: 'DIFF-A'));
        $this->assertSame(1, app(PaymentClearingReportService::class)->differences()['totals']['count']);
    }

    #[Test]
    public function aging_buckets_unsettled_captures_and_refunds_by_branch_and_respects_branch_scope(): void
    {
        $main = Branch::query()->where('is_main', true)->first() ?? Branch::create(['code' => '00001', 'name' => 'الرئيسي', 'is_main' => true]);
        $east = Branch::create(['code' => '00002', 'name' => 'فرع الشرق', 'is_main' => false]);
        [$attemptOld, $old] = $this->capture();
        [, $recent] = $this->capture();
        [, $east90] = $this->capture();
        DB::table('payments')->where('id', $old)->update(['branch_id' => $main->id, 'payment_date' => '2026-10-10']);        // 13 يوماً
        DB::table('payments')->where('id', $recent)->update(['branch_id' => $main->id, 'payment_date' => '2026-10-22']);     // يوم
        DB::table('payments')->where('id', $east90)->update(['branch_id' => $east->id, 'payment_date' => '2026-07-01']);     // أكثر من 60
        $this->travelTo(now('UTC')->setDate(2026, 9, 1)->setTime(9, 0));   // تاريخ الاسترداد المحاسبي يُثبَّت عند الترحيل ⇒ 52 يوماً
        $refund = $this->postedRefund($attemptOld, 15000);
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        DB::table('payment_refunds')->where('id', $refund->id)->update(['branch_id' => $main->id]);

        $aging = app(PaymentClearingReportService::class)->aging();
        $byBranch = collect($aging['rows'])->keyBy('branch_name');

        $this->assertSame([115000, 115000, 0, 0], $byBranch['الرئيسي']['captures']['buckets']);
        $this->assertSame(230000, $byBranch['الرئيسي']['captures']['total']);
        $this->assertSame([0, 0, 15000, 0], $byBranch['الرئيسي']['refunds']['buckets']);
        $this->assertSame([115000, 115000, -15000, 0], $byBranch['الرئيسي']['net']['buckets']);
        $this->assertSame([0, 0, 0, 115000], $byBranch['فرع الشرق']['captures']['buckets']);
        $this->assertSame(345000, $aging['totals']['captures']['total']);
        $this->assertSame(330000, $aging['totals']['net']['total']);

        // نفس إجمالي المستندات مقابل الدفتر (مطابقة هللةً بهللة على مستوى المؤسسة)
        $this->assertSame($aging['totals']['net']['total'], app(PaymentClearingReportService::class)->reconcile()['ledger_balance']);

        $only = app(PaymentClearingReportService::class)->aging(['branch_id' => [$east->id]]);
        $this->assertCount(1, $only['rows']);
        $this->assertSame(115000, $only['totals']['captures']['total']);
        $this->assertSame('branches', $only['scope']);
    }

    #[Test]
    public function the_api_enforces_permission_branch_scope_and_tenant_isolation(): void
    {
        [, $paymentId] = $this->capture();
        $main = Branch::query()->where('is_main', true)->first() ?? Branch::create(['code' => '00001', 'name' => 'الرئيسي', 'is_main' => true]);
        $east = Branch::create(['code' => '00002', 'name' => 'فرع الشرق', 'is_main' => false]);
        DB::table('payments')->where('id', $paymentId)->update(['branch_id' => $main->id]);

        $this->withToken($this->ownerToken)->getJson('/api/payment-reports/clearing-reconciliation')->assertOk()
            ->assertJsonPath('data.status', 'reconciled')->assertJsonPath('data.ledger_balance', 115000);
        $this->withToken($this->ownerToken)->getJson('/api/payment-reports/settlement-differences')->assertOk()->assertJsonPath('data.totals.count', 0);
        $this->withToken($this->ownerToken)->getJson('/api/payment-reports/clearing-aging')->assertOk()->assertJsonPath('data.totals.captures.total', 115000);

        // بلا reports.view
        $cashier = $this->tokenForRole($this->tenant->id, 'cashier', 'cashier@pay-h3-03.test');
        $this->withToken($cashier)->getJson('/api/payment-reports/clearing-reconciliation')->assertForbidden();
        $this->withToken($cashier)->getJson('/api/payment-reports/clearing-aging')->assertForbidden();

        // محاسب مقيَّد بفرع الشرق: لا مطابقة مؤسسية، ولا يرى أرقام الفرع الرئيسي
        $accountant = $this->tokenForRole($this->tenant->id, 'accountant', 'acc@pay-h3-03.test');
        User::query()->where('email', 'acc@pay-h3-03.test')->firstOrFail()->branches()->sync([$east->id]);
        $this->withToken($accountant)->getJson('/api/payment-reports/clearing-reconciliation')->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
        $this->withToken($accountant)->getJson('/api/payment-reports/settlement-differences')->assertForbidden()->assertJsonPath('error.code', 'branch_scope_forbidden');
        $this->withToken($accountant)->getJson('/api/payment-reports/clearing-aging')->assertOk()->assertJsonPath('data.totals.captures.total', 0)->assertJsonCount(0, 'data.rows');
        $this->withToken($accountant)->getJson('/api/payment-reports/clearing-aging?branch_id[]='.$main->id)->assertOk()->assertJsonPath('data.totals.captures.total', 0);

        // مستأجر آخر: بوابة غريبة ⇒ 404، وأرقامه لا تتسرب
        $other = $this->registerTenant('pay-h3-03-b', 'owner@pay-h3-03-b.test');
        $this->withToken($other['token'])->getJson('/api/payment-reports/settlement-differences?payment_gateway_id='.$this->gateway->id)->assertNotFound();
        $this->withToken($other['token'])->getJson('/api/payment-reports/clearing-reconciliation')->assertOk()->assertJsonPath('data.ledger_balance', 0);
        $this->withToken($other['token'])->getJson('/api/payment-reports/clearing-aging')->assertOk()->assertJsonPath('data.totals.captures.total', 0);
        $this->flushHeaders();
        $this->getJson('/api/payment-reports/clearing-aging')->assertUnauthorized();
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function input(string $paymentId, int $gross, array $refunds, int $net, int $fee, string $ref): array
    {
        $bank = \App\Models\CashBankAccount::where('type', 'bank')->where('is_main', true)->firstOrFail();

        return [
            'payment_gateway_id' => $this->gateway->id, 'cash_bank_account_id' => $bank->id, 'provider_settlement_ref' => $ref,
            'settlement_date' => '2026-10-23', 'net_bank_amount' => $net, 'provider_fee_ex_tax' => $fee,
            'items' => [['payment_id' => $paymentId, 'gross_amount' => $gross]],
            'refunds' => collect($refunds)->map(fn ($amount, $id) => ['payment_refund_id' => $id, 'amount_minor' => $amount])->values()->all(),
        ];
    }

    /** @param  array<string, int>  $refunds */
    private function payload(string $paymentId, int $gross, array $refunds, int $net, int $fee, string $ref): array
    {
        return $this->input($paymentId, $gross, $refunds, $net, $fee, $ref);
    }

    private function unsettledRefundRemaining(PaymentRefund $refund): int
    {
        $rows = $this->settlements->unsettledRefunds($this->gateway->id);
        $row = collect($rows)->firstWhere('refund_id', $refund->id);

        return $row === null ? 0 : (int) $row['remaining'];
    }

    private function remainingOfPayment(string $paymentId): int
    {
        $row = collect($this->settlements->unsettledPayments($this->gateway->id))->firstWhere('payment_id', $paymentId);

        return $row === null ? 0 : (int) $row['remaining'];
    }

    private function balance(string $code): int
    {
        $row = DB::table('journal_lines')
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->where('journal_lines.tenant_id', $this->tenant->id)
            ->where('accounts.code', $code)
            ->selectRaw('COALESCE(SUM(journal_lines.debit),0) as d, COALESCE(SUM(journal_lines.credit),0) as c')->first();

        return (int) $row->d - (int) $row->c;
    }

    /** @return array{0: PaymentAttempt, 1: string} الالتقاط الملتقَط المرحَّل (A1) ومعرّف سند القبض. */
    private function capture(): array
    {
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $requests = app(InvoicePaymentRequestService::class);
        $request = $requests->create($invoice, $this->gateway, $this->owner);
        $attempt = $requests->startAttempt($request, 'idem-cap-'.uniqid(), null, $this->owner);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        app(PaymentOrchestrator::class)->sync($attempt);
        $attempt = $attempt->fresh();
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->posting_status);
        $paymentId = \App\Models\PaymentAttemptPosting::query()->where('payment_attempt_id', $attempt->id)->value('payment_id');
        $this->assertNotNull($paymentId);

        return [$attempt, (string) $paymentId];
    }

    private function creditNote(): CreditNote
    {
        $service = app(CreditNoteService::class);
        $note = $service->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'refund_type' => 'credit', 'reason' => 'تصحيح تجاري'],
            [['description' => 'تصحيح', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        return $service->post($note);
    }

    /** استرداد مؤكَّد من المزوّد، والترحيل معزول (الحدث موقوف) ليُستدعى صراحةً. */
    private function confirmedRefund(PaymentAttempt $attempt, int $amount): PaymentRefund
    {
        Event::fake([PaymentRefundConfirmed::class]);
        $refunds = app(PaymentRefundService::class);
        $note = $this->creditNote();
        $refund = $refunds->request($attempt->fresh(), $amount, [['source_type' => CustomerRefundService::SOURCE_CREDIT_NOTE, 'source_id' => $note->id, 'amount' => $amount]], 'idem-set-'.uniqid(), $this->owner);
        $done = $refunds->submit($refunds->approve($refund, $this->admin), $this->admin);
        $this->assertSame(PaymentRefund::CONFIRMED, $done->status);

        return $done;
    }

    /** استرداد مؤكَّد ومرحَّل A5 (مدين 1130 / دائن 1170). */
    private function postedRefund(PaymentAttempt $attempt, int $amount): PaymentRefund
    {
        $refund = $this->confirmedRefund($attempt, $amount);
        $this->assertSame(PaymentRefundPostingService::OUTCOME_POSTED, app(PaymentRefundPostingService::class)->process($refund->fresh()));

        return $refund->fresh();
    }
}
