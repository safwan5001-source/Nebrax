<?php

namespace Tests\Feature;

use App\Events\PaymentRefundConfirmed;
use App\Models\AccountRoleMapping;
use App\Models\CashBankAccount;
use App\Models\CreditNote;
use App\Models\FiscalYear;
use App\Models\InvoicePaymentRequest;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentAttemptPosting;
use App\Models\PaymentGateway;
use App\Models\PaymentRefund;
use App\Models\PaymentRefundEvent;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\CustomerRefundService;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentRefundPostingService;
use App\Services\PaymentRefundService;
use App\Services\PaymentsRolloutControlService;
use App\Support\PaymentRefundException;
use App\Support\SchedulerHeartbeat;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H3-01c — ترحيل A5 لاستردادات البوابة المؤكَّدة (ADR-0007 §6): مدين `accounts_receivable` + الطرف / دائن `gateway_clearing`، عبر `LedgerService` حصراً.
 * يثبت: توازن القيد، عدم المساس بالإيراد والضريبة، إغلاق دورة العميل (العملاء = 0 والمقاصة = 0)، التفرد، الفترة المقفلة (R9/R10)، التسوية (R4)، والفشل المغلق.
 */
class PaymentRefundPostingTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $admin;

    private Partner $customer;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private PaymentRefundService $refunds;

    private InvoicePaymentRequestService $requests;

    private PaymentOrchestrator $orchestrator;

    private PaymentRefundPostingService $posting;

    private PlatformAdministrator $platform;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->tenant = Tenant::create(['name' => 'شركة الترحيل', 'slug' => 'pay-h3-01c', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('sales', ['allow_standalone_credit_notes' => true], $this->tenant);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h3-01c.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المدير', 'email' => 'admin@pay-h3-01c.test', 'password' => 'password123', 'role' => 'admin']);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->platform = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h3-01c.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, true, 'تفعيل للاختبار');
        $this->requests = app(InvoicePaymentRequestService::class);
        $this->orchestrator = app(PaymentOrchestrator::class);
        $this->refunds = app(PaymentRefundService::class);
        $this->posting = app(PaymentRefundPostingService::class);
    }

    // ───────────────────────── R1: استرداد كامل ─────────────────────────

    #[Test]
    public function a_full_refund_posts_debit_receivable_and_credit_clearing_and_closes_the_customer_cycle(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $revenue = $this->balance('4110');
        $tax = $this->balance('2120');
        $this->assertSame(-115000, $this->balance('1130'), 'قبل الاسترداد: رصيد العميل دائن بقيمة الإشعار');
        $this->assertSame(115000, $this->balance('1170'));
        $entriesBefore = JournalEntry::query()->count();

        $refund = $this->confirmedRefund($attempt, $note, 115000);
        $this->assertSame(PaymentRefund::POSTING_PENDING, $refund->fresh()->posting_status);
        $this->assertSame($entriesBefore, JournalEntry::query()->count(), 'التأكيد وحده لا قيد');

        $this->assertSame(PaymentRefundPostingService::OUTCOME_POSTED, $this->posting->process($refund->fresh()));

        $refund = $refund->fresh();
        $this->assertSame(PaymentRefund::POSTING_POSTED, $refund->posting_status);
        $this->assertNotNull($refund->journal_entry_id);
        $this->assertSame('2026-10-23', $refund->accounting_date->toDateString());
        $this->assertSame($entriesBefore + 1, JournalEntry::query()->count());

        $entry = JournalEntry::query()->with('lines.account')->findOrFail($refund->journal_entry_id);
        $this->assertSame(PaymentRefund::class, $entry->source_type);
        $this->assertSame($refund->id, $entry->source_id);
        $this->assertSame('2026-10-23', $entry->entry_date->toDateString());
        $rows = $entry->lines->map(fn ($l) => [$l->account->code, (int) $l->debit, (int) $l->credit, $l->partner_id])->sortByDesc(fn ($r) => $r[1])->values()->all();
        $this->assertSame([['1130', 115000, 0, $this->customer->id], ['1170', 0, 115000, null]], $rows);
        $this->assertSame(Partner::class, $entry->lines->first(fn ($l) => $l->account->code === '1130')->partner_type);
        $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'), 'قيد متوازن');

        $this->assertSame(0, $this->balance('1130'), 'العملاء = 0 بعد الاسترداد');
        $this->assertSame(0, $this->balance('1170'), 'المقاصة = 0');
        $this->assertSame($revenue, $this->balance('4110'), 'لا مساس بالإيراد');
        $this->assertSame($tax, $this->balance('2120'), 'لا مساس بالضريبة');
        $this->assertTrialBalanced();
    }

    // ───────────────────────── R2/R3: جزئيان ─────────────────────────

    #[Test]
    public function two_partial_refunds_post_two_entries_that_sum_to_the_full_one(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();

        $first = $this->confirmedRefund($attempt, $note, 40000);
        $this->posting->process($first->fresh());
        $this->assertSame(-75000, $this->balance('1130'));
        $this->assertSame(75000, $this->balance('1170'));

        $second = $this->confirmedRefund($attempt->fresh(), $note, 75000);
        $this->posting->process($second->fresh());

        $this->assertSame(0, $this->balance('1130'));
        $this->assertSame(0, $this->balance('1170'));
        $amounts = JournalEntry::query()->where('source_type', PaymentRefund::class)->with('lines')->get()
            ->map(fn ($e) => (int) $e->lines->sum('debit'))->sort()->values()->all();
        $this->assertSame([40000, 75000], $amounts);
        $this->assertSame(2, PaymentRefund::query()->where('posting_status', 'posted')->count());
        $this->assertTrialBalanced();
    }

    // ───────────────────────── R4: بعد التسوية ─────────────────────────

    #[Test]
    public function a_refund_after_settlement_posts_the_same_entry_and_leaves_clearing_credit_for_the_provider(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $paymentId = PaymentAttemptPosting::query()->where('payment_attempt_id', $attempt->id)->value('payment_id');
        $bank = CashBankAccount::query()->where('type', 'bank')->where('is_main', true)->firstOrFail();
        app(PaymentGatewaySettlementService::class)->post([
            'payment_gateway_id' => $this->gateway->id, 'cash_bank_account_id' => $bank->id, 'provider_settlement_ref' => 'SET-R4-1',
            'settlement_date' => now()->toDateString(), 'net_bank_amount' => 115000, 'provider_fee_ex_tax' => 0, 'provider_fee_tax' => 0,
            'items' => [['payment_id' => $paymentId, 'gross_amount' => 115000, 'provider_event_ref' => 'EVT-R4']],
        ]);
        $this->assertSame(0, $this->balance('1170'), 'المقاصة صفر بعد التسوية');

        $refund = $this->confirmedRefund($attempt, $note, 115000);
        $this->posting->process($refund->fresh());

        $this->assertSame(0, $this->balance('1130'));
        $this->assertSame(-115000, $this->balance('1170'), 'التزام للمزوّد يُخصم من صرفه القادم — يعالجه H3-02 (A6)');
        $entry = JournalEntry::query()->with('lines.account')->findOrFail($refund->fresh()->journal_entry_id);
        $this->assertEqualsCanonicalizing(['1130', '1170'], $entry->lines->map(fn ($l) => $l->account->code)->all());
        $this->assertTrialBalanced();
    }

    // ───────────────────────── R5/R6/R7: فشل/غير معروف/تكرار ─────────────────────────

    #[Test]
    public function failed_and_unknown_refunds_post_nothing(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $entries = JournalEntry::query()->count();

        $this->fake->failNextRefund('rejected');
        $failed = $this->approvedRefund($attempt, $note, 10000);
        $this->assertSame(PaymentRefund::FAILED, $this->refunds->submit($failed, $this->admin)->status);

        $this->fake->failNextRefund('unknown_applied');
        $unknown = $this->approvedRefund($attempt->fresh(), $note, 10000);
        $this->assertSame(PaymentRefund::UNKNOWN, $this->refunds->submit($unknown, $this->admin)->status);

        $this->assertSame($entries, JournalEntry::query()->count());
        $this->assertSame([], $this->posting->runPending() === ['processed' => 0, 'posted' => 0, 'blocked' => 0, 'failed' => 0] ? [] : ['posted unexpectedly']);
    }

    #[Test]
    public function reprocessing_a_posted_refund_never_creates_a_second_entry(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $spare = $this->creditNote();
        $refund = $this->confirmedRefund($attempt, $note, 100000);
        $this->posting->process($refund->fresh());
        $entries = JournalEntry::query()->count();

        $this->assertSame(PaymentRefundPostingService::OUTCOME_ALREADY_POSTED, $this->posting->process($refund->fresh()));
        $this->assertSame(PaymentRefundPostingService::OUTCOME_ALREADY_POSTED, $this->posting->process($refund->fresh(), true));
        $this->assertSame(['processed' => 0, 'posted' => 0, 'blocked' => 0, 'failed' => 0], $this->posting->runPending());
        $this->assertSame(0, Artisan::call('payments:post-refunds'));
        $this->assertSame($entries, JournalEntry::query()->count());

        // القاعدة تمنع ربط القيد نفسه باستردادين.
        $other = $this->approvedRefund($attempt->fresh(), $spare, 1000);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $other->id)->update(['journal_entry_id' => $refund->fresh()->journal_entry_id])), 'journal reuse', QueryException::class);
    }

    // ───────────────────────── R9/R10: الفترة المقفلة ─────────────────────────

    #[Test]
    public function a_confirmed_refund_in_a_locked_period_keeps_its_proof_and_is_blocked_without_redating(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        $entries = JournalEntry::query()->count();

        $refund = $this->confirmedRefund($attempt, $note, 115000);
        $outcome = $this->posting->process($refund->fresh());

        $this->assertSame(PaymentRefundPostingService::OUTCOME_BLOCKED_PERIOD, $outcome);
        $fresh = $refund->fresh();
        $this->assertSame(PaymentRefund::CONFIRMED, $fresh->status, 'الإثبات محفوظ');
        $this->assertSame(PaymentRefund::POSTING_BLOCKED_PERIOD, $fresh->posting_status);
        $this->assertSame('period', $fresh->posting_blocked_reason['kind']);
        $this->assertSame('2026-10-23', $fresh->accounting_date->toDateString(), 'بلا إعادة تأريخ');
        $this->assertNull($fresh->journal_entry_id);
        $this->assertNotNull($fresh->provider_refund_ref);
        $this->assertSame(115000, $fresh->provider_refunded_minor);
        $this->assertNotNull($fresh->provider_refunded_at);
        $this->assertSame(115000, $attempt->fresh()->refunded_minor);
        $this->assertSame($entries, JournalEntry::query()->count());
        $this->assertSame(['processed' => 0, 'posted' => 0, 'blocked' => 0, 'failed' => 0], $this->posting->runPending(), 'المحجوب لا يُعاد ترحيله تلقائياً');
        $this->assertSame(PaymentRefundPostingService::OUTCOME_BLOCKED_PERIOD, $this->posting->process($fresh->fresh()));
    }

    #[Test]
    public function an_authorised_repost_after_a_formal_reopen_posts_with_the_original_date_and_is_audited(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $lock = app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        $refund = $this->confirmedRefund($attempt, $note, 115000);
        $this->posting->process($refund->fresh());

        // مرة أولى والفترة ما زالت مقفلة ⇒ still_blocked ويُسجَّل القرار.
        $this->assertSame('blocked_period', $this->posting->repost($refund->fresh(), $this->owner, 'محاولة قبل فتح الفترة'));
        $this->assertSame('still_blocked', PaymentRefundEvent::query()->where('action', 'repost')->latest('created_at')->first()->meta['outcome']);

        app(AccountingPeriodLockService::class)->release($lock['id'], 'فتح رسمي', $this->owner);
        $this->assertSame('posted', $this->posting->repost($refund->fresh(), $this->owner, 'فتح الفترة رسمياً بموافقة المدير المالي'));

        $fresh = $refund->fresh();
        $this->assertSame(PaymentRefund::POSTING_POSTED, $fresh->posting_status);
        $this->assertSame('2026-10-23', $fresh->accounting_date->toDateString());
        $this->assertNull($fresh->posting_blocked_reason);
        $this->assertSame('2026-10-23', JournalEntry::query()->findOrFail($fresh->journal_entry_id)->entry_date->toDateString());
        $this->assertSame(0, $this->balance('1130'));
        $this->assertSame(2, PaymentRefundEvent::query()->where('action', 'repost')->count());
        $this->assertTrialBalanced();
    }

    #[Test]
    public function repost_requires_the_blocked_permission_a_reason_and_a_blocked_refund(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $spare = $this->creditNote();
        app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        $refund = $this->confirmedRefund($attempt, $note, 100000);
        $this->posting->process($refund->fresh());
        $accountant = User::create(['tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'acc@pay-h3-01c.test', 'password' => 'password123', 'role' => 'accountant']);

        $e = $this->thrown(fn () => $this->posting->repost($refund->fresh(), $accountant, 'سبب كافٍ للقرار'), 'forbidden', PaymentRefundException::class);
        $this->assertSame('forbidden', $e->reason);
        $e = $this->thrown(fn () => $this->posting->repost($refund->fresh(), $this->owner, 'abc'), 'reason', PaymentRefundException::class);
        $this->assertSame('reason_required', $e->reason);

        $other = $this->confirmedRefund($attempt->fresh(), $spare, 1000);
        $e = $this->thrown(fn () => $this->posting->repost($other->fresh(), $this->owner, 'ليس محجوباً أصلاً'), 'not blocked', PaymentRefundException::class);
        $this->assertSame('not_blocked', $e->reason);
        $this->assertSame(0, PaymentRefundEvent::query()->where('action', 'repost')->count());
    }

    #[Test]
    public function a_closed_fiscal_year_blocks_the_refund_with_a_year_reason_and_close_readiness_warns(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->confirmedRefund($attempt, $note, 115000);
        $created = app(FiscalYearService::class)->create(['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null);
        $year = FiscalYear::query()->findOrFail($created['id']);
        $year->forceFill(['status' => FiscalYear::STATUS_CLOSED])->save();

        $this->assertSame(PaymentRefundPostingService::OUTCOME_BLOCKED_PERIOD, $this->posting->process($refund->fresh()));
        $fresh = $refund->fresh();
        $this->assertSame('year', $fresh->posting_blocked_reason['kind']);
        $this->assertSame(PaymentRefund::CONFIRMED, $fresh->status);

        $year->forceFill(['status' => FiscalYear::STATUS_OPEN])->save();
        $warning = collect(app(FiscalCloseService::class)->readiness($year->fresh())['warnings'])->firstWhere('code', 'blocked_refunds');
        $this->assertNotNull($warning);
        $this->assertSame(1, $warning['details']['count']);
        $this->assertSame(115000, $warning['details']['amount_minor']);
    }

    // ───────────────────────── الفشل المغلق وشبكة الأمان ─────────────────────────

    #[Test]
    public function a_missing_role_mapping_fails_closed_and_the_safety_net_posts_it_once_restored(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->confirmedRefund($attempt, $note, 115000);
        $mapping = AccountRoleMapping::query()->where('role_key', 'gateway_clearing')->firstOrFail();
        $backup = $mapping->only(['role_key', 'account_id']);
        DB::table('account_role_mappings')->where('id', $mapping->id)->delete();
        $entries = JournalEntry::query()->count();

        $this->thrown(fn () => $this->posting->process($refund->fresh()), 'unmapped', \RuntimeException::class);
        $this->assertSame($entries, JournalEntry::query()->count());
        $this->assertSame(PaymentRefund::POSTING_PENDING, $refund->fresh()->posting_status);
        $this->assertSame(1, $this->safely(fn () => $this->posting->runPending())['failed']);

        AccountRoleMapping::query()->create($backup + ['tenant_id' => $this->tenant->id]);
        $this->assertSame(1, $this->posting->runPending()['posted']);
        $this->assertSame(PaymentRefund::POSTING_POSTED, $refund->fresh()->posting_status);
    }

    #[Test]
    public function repeatedly_failing_refunds_do_not_starve_later_pending_ones_in_the_safety_net(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $first = $this->confirmedRefund($attempt, $note, 40000);
        $second = $this->confirmedRefund($attempt, $note, 30000);
        $mapping = AccountRoleMapping::query()->where('role_key', 'gateway_clearing')->firstOrFail();
        $backup = $mapping->only(['role_key', 'account_id']);
        DB::table('account_role_mappings')->where('id', $mapping->id)->delete();
        $firstTouched = $first->fresh()->updated_at->getTimestamp();
        $secondTouched = $second->fresh()->updated_at->getTimestamp();

        $this->travel(1)->minute();
        $this->assertSame(1, $this->safely(fn () => $this->posting->runPending(1))['failed']);
        $this->travel(1)->minute();
        $this->assertSame(1, $this->safely(fn () => $this->posting->runPending(1))['failed']);

        // الدورتان بحدّ 1 بلغتا الاسترداد كليهما (لولا التأخير لأعادت الدورتان الأول وحده)
        $this->assertNotEquals($firstTouched, $first->fresh()->updated_at->getTimestamp());
        $this->assertNotEquals($secondTouched, $second->fresh()->updated_at->getTimestamp());

        AccountRoleMapping::query()->create($backup + ['tenant_id' => $this->tenant->id]);
        $this->assertSame(2, $this->posting->runPending()['posted']);
    }

    #[Test]
    public function close_readiness_warns_about_confirmed_refunds_stuck_unposted(): void
    {
        $refund = $this->confirmedRefund($this->postedCapture(), $this->creditNote(), 115000);
        $created = app(FiscalYearService::class)->create(['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null);
        $year = FiscalYear::query()->findOrFail($created['id']);
        $codes = fn () => collect(app(FiscalCloseService::class)->readiness($year->fresh())['warnings'])->pluck('code');

        $this->assertNotContains('unposted_refunds', $codes(), 'قبل مرور ساعة لا تنبيه (المستمع قد يكون في الطريق)');
        $this->travel(2)->hours();
        $warning = collect(app(FiscalCloseService::class)->readiness($year->fresh())['warnings'])->firstWhere('code', 'unposted_refunds');
        $this->assertNotNull($warning);
        $this->assertSame(115000, $warning['details']['amount_minor']);

        $this->posting->process($refund->fresh());
        $this->assertNotContains('unposted_refunds', $codes());
    }

    #[Test]
    public function the_transition_trigger_rejects_null_posting_status_jumps(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->approvedRefund($attempt, $note, 115000);   // posting_status = NULL
        foreach (['posted', 'blocked_period', 'bogus'] as $to) {
            $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $refund->id)->update(['posting_status' => $to])), "null→{$to}", QueryException::class);
        }
        $confirmed = $this->confirmedRefund($this->postedCapture(), $this->creditNote(), 115000);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $confirmed->id)->update(['posting_status' => null])), 'pending→null', QueryException::class);
        $this->assertSame(PaymentRefund::POSTING_PENDING, $confirmed->fresh()->posting_status);
    }

    #[Test]
    public function confirmation_dispatches_the_listener_that_posts_without_a_manual_call(): void
    {
        \Illuminate\Support\Facades\Event::swap(new \Illuminate\Events\Dispatcher($this->app));
        (new \App\Providers\PaymentPostingServiceProvider($this->app))->boot();
        $attempt = $this->postedCapture();
        $note = $this->creditNote();

        $refund = $this->refunds->request($attempt, 115000, $this->alloc($note, 115000), 'idem-listener-001', $this->owner);
        $this->refunds->approve($refund, $this->admin);
        $done = $this->refunds->submit($refund->fresh(), $this->admin);

        $fresh = $done->fresh();
        $this->assertSame(PaymentRefund::POSTING_POSTED, $fresh->posting_status);
        $this->assertNotNull($fresh->journal_entry_id);
        $this->assertSame(0, $this->balance('1130'));
    }

    #[Test]
    public function an_emergency_platform_stop_does_not_block_posting_a_confirmed_refund(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->confirmedRefund($attempt, $note, 115000);
        app(PaymentsRolloutControlService::class)->setPlatformState($this->platform, false, 'إيقاف طارئ للاختبار');

        $this->assertSame(PaymentRefundPostingService::OUTCOME_POSTED, $this->posting->process($refund->fresh()), 'ما خرج من المال يجب أن يُرحَّل');
    }

    // ───────────────────────── الثبات والأمان ─────────────────────────

    #[Test]
    public function the_database_and_model_guard_posting_transitions_and_there_is_no_reversal_path(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->confirmedRefund($attempt, $note, 115000);
        $this->posting->process($refund->fresh());
        $posted = $refund->fresh();

        $this->thrown(fn () => $posted->forceFill(['posting_status' => PaymentRefund::POSTING_PENDING])->save(), 'model posted→pending', \LogicException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $posted->id)->update(['posting_status' => 'pending'])), 'db posted→pending', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $posted->id)->update(['journal_entry_id' => null])), 'db journal cleared', QueryException::class);
        $this->assertFalse(method_exists($this->posting, 'reverse'), 'R11: لا عكس لاسترداد مؤكَّد');
        $this->assertSame(PaymentRefund::POSTING_POSTED, $posted->fresh()->posting_status);
    }

    #[Test]
    public function the_refund_layer_writes_the_ledger_only_through_ledger_service_post(): void
    {
        $posting = (string) file_get_contents(base_path('app/Services/PaymentRefundPostingService.php'));
        $this->assertStringContainsString('$this->ledger->post(', $posting);
        $this->assertDoesNotMatchRegularExpression('/JournalLine|JournalEntry::|journal_lines|journal_entries|->reverse\(/', $posting, 'لا كتابة مباشرة في الأستاذ ولا عكس');
        $lifecycle = (string) file_get_contents(base_path('app/Services/PaymentRefundService.php'));
        $this->assertDoesNotMatchRegularExpression('/LedgerService|JournalLine|journal_lines|journal_entries/', $lifecycle, 'دورة الحياة بلا أي مساس بالأستاذ');
    }

    #[Test]
    public function another_tenant_never_posts_or_sees_this_tenants_confirmed_refunds(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->confirmedRefund($attempt, $note, 115000);

        // المطابِق الدوري يعمل بلا سياق مستأجر ويرحّل كل مستأجر في سياقه.
        app(TenantContext::class)->forget();
        $this->assertSame(1, $this->posting->runPending()['posted']);
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(PaymentRefund::POSTING_POSTED, $refund->fresh()->posting_status);

        $other = Tenant::create(['name' => 'مستأجر آخر', 'slug' => 'pay-h3-01c-b', 'vat_number' => '300000000000023', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $this->assertNull(PaymentRefund::query()->find($refund->id));
        $this->assertSame(0, JournalEntry::query()->where('source_type', PaymentRefund::class)->count());
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function safely(callable $operation): array
    {
        return $operation();
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

    private function assertTrialBalanced(): void
    {
        $row = DB::table('journal_lines')->where('tenant_id', $this->tenant->id)->selectRaw('SUM(debit) as d, SUM(credit) as c')->first();
        $this->assertSame((int) $row->d, (int) $row->c, 'ميزان المراجعة متوازن');
    }

    /** @return list<array{source_type: string, source_id: string, amount: int}> */
    private function alloc(CreditNote $note, int $amount): array
    {
        return [['source_type' => CustomerRefundService::SOURCE_CREDIT_NOTE, 'source_id' => $note->id, 'amount' => $amount]];
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

    private function postedCapture(): PaymentAttempt
    {
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $this->assertInstanceOf(InvoicePaymentRequest::class, $request);
        $attempt = $this->requests->startAttempt($request, 'idem-cap-'.uniqid(), null, $this->owner);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $this->orchestrator->sync($attempt);
        $attempt = $attempt->fresh();
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->posting_status);

        return $attempt;
    }

    private function approvedRefund(PaymentAttempt $attempt, CreditNote $note, int $amount): PaymentRefund
    {
        $refund = $this->refunds->request($attempt, $amount, $this->alloc($note, $amount), 'idem-pst-'.uniqid(), $this->owner);

        return $this->refunds->approve($refund, $this->admin);
    }

    /** استرداد مؤكَّد من المزوّد، والترحيل معزول (الحدث موقوف) ليُستدعى صراحةً في الاختبار. */
    private function confirmedRefund(PaymentAttempt $attempt, CreditNote $note, int $amount): PaymentRefund
    {
        \Illuminate\Support\Facades\Event::fake([PaymentRefundConfirmed::class]);
        $done = $this->refunds->submit($this->approvedRefund($attempt, $note, $amount), $this->admin);
        $this->assertSame(PaymentRefund::CONFIRMED, $done->status);

        return $done;
    }
}
