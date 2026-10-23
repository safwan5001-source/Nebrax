<?php

namespace Tests\Feature;

use App\Events\PaymentAttemptCaptured;
use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentAttemptPostingService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * PAY-H2-02c — ترحيل التقاط الدفع الإلكتروني لفاتورة (ADR-0006 M1–M8). فاتورة الاختبار 1,150.00 ر.س (115000 هللة).
 * القيد المتوقع لكل سند: مدين 1170 (مستحقات بوابات الدفع) / دائن 1130 (العملاء + الطرف) بمبلغ السند — عبر `PaymentService` حصراً.
 */
class PaymentAttemptPostingTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Partner $customer;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private InvoicePaymentRequestService $requests;

    private PaymentOrchestrator $orchestrator;

    private PaymentAttemptPostingService $posting;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->tenant = Tenant::create(['name' => 'شركة ترحيل الالتقاط', 'slug' => 'pay-h2-02c', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h2-02c.test', 'password' => 'password123', 'role' => 'owner']);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h2-02c.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($admin, $this->tenant->id, true, 'تفعيل للاختبار');
        $this->requests = app(InvoicePaymentRequestService::class);
        $this->orchestrator = app(PaymentOrchestrator::class);
        $this->posting = app(PaymentAttemptPostingService::class);
    }

    // ═══════════════ M1 / M2 ═══════════════

    #[Test]
    public function a_normal_capture_posts_one_gateway_receipt_allocated_to_the_invoice(): void
    {
        $invoice = $this->invoice();
        $zatcaBefore = $this->zatca($invoice);
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);

        $attempt = $this->capture($request);

        $attempt->refresh();
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->posting_status);
        $this->assertSame('2026-10-23', $attempt->accounting_date->toDateString());
        $this->assertNotNull($attempt->posted_at);
        $this->assertNull($attempt->review_reasons);

        $payment = Payment::query()->sole();
        $this->assertSame(115000, $payment->amount);
        $this->assertSame('posted', $payment->status);
        $this->assertSame($this->gateway->id, $payment->payment_gateway_id);
        $this->assertSame($attempt->provider_payment_id, $payment->reference);
        $this->assertSame([['1170', 115000, 0], ['1130', 0, 115000]], $this->lines($payment));
        $this->assertSame($invoice->partner_id, $this->partnerOfCreditLine($payment));

        $invoice->refresh();
        $this->assertSame(115000, $invoice->paid_amount);
        $this->assertSame('paid', $invoice->payment_status);
        $this->assertSame('completed', $request->fresh()->status);
        $this->assertSame(1, DB::table('payment_attempt_postings')->count());
        $this->assertSame($zatcaBefore, $this->zatca($invoice), 'لا مساس بـZATCA');
    }

    #[Test]
    public function a_partial_capture_posts_the_partial_amount_and_keeps_the_request_open(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner, true);

        $this->capture($request, 50000);

        $payment = Payment::query()->sole();
        $this->assertSame(50000, $payment->amount);
        $this->assertSame([['1170', 50000, 0], ['1130', 0, 50000]], $this->lines($payment));
        $invoice->refresh();
        $this->assertSame(50000, $invoice->paid_amount);
        $this->assertSame('partial', $invoice->payment_status);
        $this->assertSame('open', $request->fresh()->status);
    }

    // ═══════════════ M3 / M3ب ═══════════════

    #[Test]
    public function an_overpayment_splits_into_an_allocated_voucher_and_an_unallocated_credit_with_review(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $started = $this->start($request);                 // المحاولة بكامل 115000
        $this->payElsewhere($invoice, 20000);              // المتبقي ينخفض إلى 95000 قبل الالتقاط

        $attempt = $this->captureStarted($started);

        $this->assertSame(2, Payment::query()->where('payment_gateway_id', $this->gateway->id)->count());
        $allocated = $this->voucher($attempt, 'allocated');
        $excess = $this->voucher($attempt, 'excess');
        $this->assertSame(95000, $allocated->amount);
        $this->assertSame(20000, $excess->amount);
        $this->assertSame([['1170', 95000, 0], ['1130', 0, 95000]], $this->lines($allocated));
        $this->assertSame([['1170', 20000, 0], ['1130', 0, 20000]], $this->lines($excess));
        $this->assertSame(0, $excess->allocations()->count(), 'الفائض رصيد دائن غير مخصص لا إيراد');
        $invoice->refresh();
        $this->assertSame(115000, $invoice->paid_amount);
        $this->assertSame('paid', $invoice->payment_status);
        $this->assertContains(PaymentAttempt::REVIEW_OVERPAYMENT, $attempt->fresh()->review_reasons);
    }

    #[Test]
    public function a_capture_on_an_already_settled_invoice_posts_only_an_unallocated_credit(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $started = $this->start($request);
        $this->payElsewhere($invoice, 115000);

        $attempt = $this->captureStarted($started);

        $payments = Payment::query()->where('payment_gateway_id', $this->gateway->id)->get();
        $this->assertCount(1, $payments);
        $this->assertSame('excess', DB::table('payment_attempt_postings')->where('payment_attempt_id', $attempt->id)->value('role'));
        $this->assertSame(0, $payments->first()->allocations()->count());
        $this->assertSame(115000, $invoice->fresh()->paid_amount, 'لا تغيير في السداد');
        $this->assertContains(PaymentAttempt::REVIEW_OVERPAYMENT, $attempt->fresh()->review_reasons);
    }

    // ═══════════════ M4 ═══════════════

    #[Test]
    public function duplicate_events_reconciliations_and_calls_never_create_a_second_voucher_or_entry(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $attempt = $this->capture($request);
        $entries = JournalEntry::query()->where('source_type', Payment::class)->count();

        $this->orchestrator->sync($attempt->fresh());                 // لقطة مكررة
        event(new PaymentAttemptCaptured((string) $this->tenant->id, $attempt->id));
        event(new PaymentAttemptCaptured((string) $this->tenant->id, $attempt->id));
        $this->assertSame(PaymentAttemptPostingService::OUTCOME_ALREADY_POSTED, $this->posting->process($attempt->fresh()));
        $this->posting->runPending();

        $this->assertSame(1, Payment::query()->count());
        $this->assertSame($entries, JournalEntry::query()->where('source_type', Payment::class)->count());
        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertSame(1, DB::table('payment_attempt_postings')->count());
    }

    #[Test]
    public function a_failure_between_the_two_vouchers_rolls_everything_back_then_a_retry_posts_the_set_once(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $started = $this->start($request);
        $this->payElsewhere($invoice, 20000);
        $paymentsBefore = Payment::query()->count();
        $entriesBefore = JournalEntry::query()->count();

        $real = app(PaymentService::class);
        $posts = 0;
        $this->app->bind(PaymentService::class, fn () => new class($real, $posts) extends PaymentService {
            public function __construct(private PaymentService $real, private int &$posts)
            {
            }

            public function create(array $data, array $allocations = []): Payment
            {
                return $this->real->create($data, $allocations);
            }

            public function post(Payment $payment, ?User $actor = null): Payment
            {
                if (++$this->posts === 2) {
                    throw new RuntimeException('انهيار بعد السند الأول');
                }

                return $this->real->post($payment, $actor);
            }
        });
        $this->app->forgetInstance(PaymentAttemptPostingService::class);

        $this->fake->script($started->provider_payment_id, 'captured');
        Event::fake([PaymentAttemptCaptured::class]);
        $this->orchestrator->sync($started);
        $attempt = $started->fresh();
        $thrown = $this->thrown(fn () => $this->app->make(PaymentAttemptPostingService::class)->process($attempt), 'crash between vouchers', RuntimeException::class);
        $this->assertStringContainsString('انهيار', $thrown->getMessage());

        $this->assertSame($paymentsBefore, Payment::query()->count(), 'لا سند يتيم');
        $this->assertSame($entriesBefore, JournalEntry::query()->count(), 'لا قيد يتيم');
        $this->assertSame(0, DB::table('payment_attempt_postings')->count());
        $this->assertSame(95000 + 0, $invoice->fresh()->total - $invoice->fresh()->paid_amount, 'السداد دون تغيير');
        $this->assertSame(PaymentAttempt::POSTING_PENDING, $attempt->fresh()->posting_status);

        // إعادة بالخدمة السليمة تُنتج المجموعة كاملة مرة واحدة.
        $this->app->bind(PaymentService::class, fn () => $real);
        $this->app->forgetInstance(PaymentAttemptPostingService::class);
        $this->assertSame('posted', $this->app->make(PaymentAttemptPostingService::class)->process($attempt->fresh()));
        $this->assertSame($paymentsBefore + 2, Payment::query()->count());
        $this->assertSame(2, DB::table('payment_attempt_postings')->count());
    }

    #[Test]
    public function the_database_refuses_a_second_voucher_for_the_same_attempt_role(): void
    {
        $request = $this->requests->create($this->invoice(), $this->gateway, $this->owner);
        $attempt = $this->capture($request);
        $existing = DB::table('payment_attempt_postings')->where('payment_attempt_id', $attempt->id)->first();
        $other = app(PaymentService::class)->create(['partner_id' => $this->customer->id, 'amount' => 100, 'direction' => 'received', 'method' => 'cash']);

        $before = DB::table('payment_attempt_postings')->count();
        $this->thrownDb(fn () => DB::table('payment_attempt_postings')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenant->id, 'payment_attempt_id' => $attempt->id,
            'role' => $existing->role, 'payment_id' => $other->id, 'amount_minor' => 100, 'created_at' => now(),
        ]));
        $this->assertSame($before, DB::table('payment_attempt_postings')->count());
    }

    // ═══════════════ M5 ═══════════════

    #[Test]
    public function a_capture_in_a_locked_period_is_blocked_without_voucher_entry_date_change_or_paid_amount_change(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $lock = app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        $entriesBefore = JournalEntry::query()->count();

        $attempt = $this->capture($request);

        $attempt->refresh();
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, $attempt->capture_status, 'إثبات الدفع محفوظ');
        $this->assertSame(115000, $attempt->captured_minor);
        $this->assertSame(PaymentAttempt::POSTING_BLOCKED_PERIOD, $attempt->posting_status);
        $this->assertSame('2026-10-23', $attempt->accounting_date->toDateString(), 'التاريخ لا يتغير تلقائياً');
        $this->assertSame('period', $attempt->posting_blocked_reason['kind']);
        $this->assertSame($lock['id'], $attempt->posting_blocked_reason['lock_id']);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame($entriesBefore, JournalEntry::query()->count());
        $this->assertSame(0, $invoice->fresh()->paid_amount);
        $this->assertSame('open', $request->fresh()->status);

        // لا إعادة ترحيل تلقائية (لا مطابِق ولا حدث) حتى لو فُتحت الفترة.
        app(AccountingPeriodLockService::class)->release($lock['id'], 'فتح رسمي', $this->owner);
        $this->assertSame(PaymentAttemptPostingService::OUTCOME_BLOCKED_PERIOD, $this->posting->process($attempt->fresh()));
        $this->posting->runPending();
        $this->assertSame(0, Payment::query()->count());

        // R1: إعادة ترحيل صريحة بالتاريخ الأصلي.
        $this->assertSame(PaymentAttemptPostingService::OUTCOME_POSTED, $this->posting->process($attempt->fresh(), true));
        $payment = Payment::query()->sole();
        $this->assertSame('2026-10-23', $payment->payment_date->toDateString());
        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->fresh()->posting_status);
    }

    #[Test]
    public function a_capture_dated_in_a_closed_fiscal_year_is_blocked_with_the_year_reason(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $year = app(FiscalYearService::class)->create(['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null);
        app(FiscalCloseService::class)->close($year['id'], null);

        $attempt = $this->capture($request);

        $attempt->refresh();
        $this->assertSame(PaymentAttempt::POSTING_BLOCKED_PERIOD, $attempt->posting_status);
        $this->assertSame('year', $attempt->posting_blocked_reason['kind']);
        $this->assertSame($year['id'], $attempt->posting_blocked_reason['fiscal_year_id']);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, $invoice->fresh()->paid_amount);
    }

    #[Test]
    public function the_accounting_date_is_the_riyadh_calendar_day_of_the_provider_capture(): void
    {
        // 22:30 UTC = 01:30 اليوم التالي بتوقيت الرياض.
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(22, 30));
        $attempt = $this->capture($this->requests->create($this->invoice(), $this->gateway, $this->owner));

        $this->assertSame('2026-10-24', $attempt->fresh()->accounting_date->toDateString());
        $this->assertSame('2026-10-24', Payment::query()->sole()->payment_date->toDateString());
    }

    // ═══════════════ M6 / M7 / M8 ═══════════════

    #[Test]
    public function an_amount_or_currency_mismatch_is_held_for_review_without_posting(): void
    {
        $request = $this->requests->create($this->invoice(), $this->gateway, $this->owner);
        $attempt = $this->capture($request, null, 120000);   // الملتقط أكبر من مبلغ المحاولة

        $attempt->refresh();
        $this->assertContains(PaymentAttempt::REVIEW_AMOUNT_MISMATCH, $attempt->review_reasons);
        $this->assertSame(PaymentAttempt::POSTING_PENDING, $attempt->posting_status);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(PaymentAttemptPostingService::OUTCOME_HELD, $this->posting->process($attempt));
        $this->assertSame(0, $this->posting->runPending()['processed'], 'المحتجَز لا يُزاحم المطابِق');
    }

    #[Test]
    public function failed_authorized_and_cancelled_attempts_never_post_or_get_a_posting_state(): void
    {
        $request = $this->requests->create($this->invoice(), $this->gateway, $this->owner);
        $attempt = $this->requests->startAttempt($request, 'idem-post-0001', null, $this->owner);
        $this->fake->script($attempt->provider_payment_id, 'authorized');
        $this->orchestrator->sync($attempt);

        $this->assertNull($attempt->fresh()->posting_status);
        $this->assertSame(PaymentAttemptPostingService::OUTCOME_SKIPPED, $this->posting->process($attempt->fresh()));
        $this->assertSame(0, Payment::query()->count());
    }

    #[Test]
    public function a_late_capture_after_local_expiry_posts_and_is_flagged(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $attempt = $this->requests->startAttempt($request, 'idem-post-0002', null, $this->owner);
        $this->orchestrator->cancel($attempt);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $this->orchestrator->sync($attempt->fresh());

        $attempt->refresh();
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->posting_status);
        $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $attempt->review_reasons);
        $this->assertSame(115000, $invoice->fresh()->paid_amount);
    }

    // ═══════════════ شبكة الأمان / العزل / التوافق ═══════════════

    #[Test]
    public function the_pending_sweeper_posts_a_capture_whose_listener_never_ran(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        Event::fake([PaymentAttemptCaptured::class]);
        $attempt = $this->capture($request);
        $this->assertSame(PaymentAttempt::POSTING_PENDING, $attempt->fresh()->posting_status);
        $this->assertSame(0, Payment::query()->count());

        $summary = $this->posting->runPending();

        $this->assertSame(1, $summary['posted']);
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->fresh()->posting_status);
        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertSame((string) $this->tenant->id, app(TenantContext::class)->id(), 'المطابِق يعيد السياق السابق');
    }

    #[Test]
    public function another_tenant_cannot_post_or_even_resolve_this_tenants_attempt(): void
    {
        $request = $this->requests->create($this->invoice(), $this->gateway, $this->owner);
        Event::fake([PaymentAttemptCaptured::class]);
        $attempt = $this->capture($request);

        $other = Tenant::create(['name' => 'مستأجر آخر', 'slug' => 'pay-h2-02c-b', 'vat_number' => '300000000000021', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);

        $this->assertNull(PaymentAttempt::query()->find($attempt->id));
        (new \App\Listeners\PostCapturedPaymentAttempt($this->posting, app(TenantContext::class)))
            ->handle(new PaymentAttemptCaptured((string) $this->tenant->id, $attempt->id));
        $this->assertSame(0, Payment::query()->count());

        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(PaymentAttempt::POSTING_PENDING, $attempt->fresh()->posting_status);
        $this->assertSame(0, Payment::query()->count());
    }

    #[Test]
    public function the_posting_service_writes_no_ledger_rows_directly_and_other_payables_are_not_handled(): void
    {
        $source = file_get_contents(app_path('Services/PaymentAttemptPostingService.php'));
        $this->assertDoesNotMatchRegularExpression('/LedgerService|JournalEntry|JournalLine|table\([\'"]journal_|ZatcaService|InvoiceService/', $source);
        $this->assertFalse(PaymentAttemptPostingService::handles('test_payable:abc'));
        $this->assertTrue(PaymentAttemptPostingService::handles('invoice_payment_request:abc'));
    }

    // ═══════════════ أدوات ═══════════════

    private function start(InvoicePaymentRequest $request, ?int $amount = null): PaymentAttempt
    {
        static $n = 0;

        return $this->requests->startAttempt($request, 'idem-cap-'.str_pad((string) ++$n, 4, '0', STR_PAD_LEFT), $amount, $this->owner);
    }

    /** يبرمج التقاط المزوّد ويطبّقه عبر المنسّق (الذي يطلق حدث الترحيل بعد الالتزام). */
    private function captureStarted(PaymentAttempt $attempt, ?int $capturedMinor = null): PaymentAttempt
    {
        $this->fake->script($attempt->provider_payment_id, 'captured', $capturedMinor);
        $this->orchestrator->sync($attempt);

        return $attempt->fresh();
    }

    private function capture(InvoicePaymentRequest $request, ?int $amount = null, ?int $capturedMinor = null): PaymentAttempt
    {
        return $this->captureStarted($this->start($request, $amount), $capturedMinor);
    }

    private function invoice(): Invoice
    {
        return app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
    }

    /** سداد جزئي/كلي خارجي (نقدي) بالمسار القائم — يغيّر المتبقي بعد إنشاء الطلب. */
    private function payElsewhere(Invoice $invoice, int $amount): void
    {
        $payments = app(PaymentService::class);
        $payments->post($payments->create([
            'partner_id' => $invoice->partner_id, 'amount' => $amount, 'direction' => 'received', 'method' => 'cash', 'invoice_id' => $invoice->id,
        ]));
    }

    private function voucher(PaymentAttempt $attempt, string $role): Payment
    {
        return Payment::query()->findOrFail(DB::table('payment_attempt_postings')->where('payment_attempt_id', $attempt->id)->where('role', $role)->value('payment_id'));
    }

    /** @return list<array{0: string, 1: int, 2: int}> [رمز الحساب، مدين، دائن] مرتبة مدين أولاً. */
    private function lines(Payment $payment): array
    {
        return DB::table('journal_lines')->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->where('journal_lines.journal_entry_id', $payment->journal_entry_id)
            ->orderByDesc('journal_lines.debit')->get(['accounts.code', 'journal_lines.debit', 'journal_lines.credit'])
            ->map(fn ($l) => [$l->code, (int) $l->debit, (int) $l->credit])->all();
    }

    private function partnerOfCreditLine(Payment $payment): ?string
    {
        return DB::table('journal_lines')->where('journal_entry_id', $payment->journal_entry_id)->where('credit', '>', 0)->value('partner_id');
    }

    /** @return array<string, mixed> */
    private function zatca(Invoice $invoice): array
    {
        return collect(DB::table('invoices')->where('id', $invoice->id)->first())
            ->filter(fn ($v, $k) => str_starts_with((string) $k, 'zatca_'))->all();
    }

    private function thrownDb(callable $fn): void
    {
        $this->thrown(fn () => DB::transaction($fn), 'db constraint', \Illuminate\Database\QueryException::class);
    }
}
