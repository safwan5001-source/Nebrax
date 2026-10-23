<?php

namespace Tests\Feature;

use App\Events\PaymentRefundConfirmed;
use App\Models\CreditNote;
use App\Models\CustomerRefund;
use App\Models\InvoicePaymentRequest;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentRefund;
use App\Models\PaymentRefundAllocation;
use App\Models\PaymentRefundAttempt;
use App\Models\PaymentRefundAttemptResult;
use App\Models\PaymentRefundEvent;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\CustomerRefundService;
use App\Services\Accounting\InvoiceService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentRefundService;
use App\Services\PaymentsRolloutControlService;
use App\Support\PaymentRefundException;
use App\Support\Rbac;
use App\Support\SchedulerHeartbeat;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * PAY-H3-01b — مخطط استرداد البوابة ودورة حياته (ADR-0007). **لا قيود:** كل اختبار هنا يثبت أن الاسترداد لا يكتب في الدفتر (القيد A5 شريحة 01c).
 */
class PaymentRefundTest extends TestCase
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

    private PlatformAdministrator $platform;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->tenant = Tenant::create(['name' => 'شركة الاسترداد', 'slug' => 'pay-h3-01b', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('sales', ['allow_standalone_credit_notes' => true], $this->tenant);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h3-01b.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المدير', 'email' => 'admin@pay-h3-01b.test', 'password' => 'password123', 'role' => 'admin']);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->platform = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h3-01b.test', 'password' => 'platform-password-123']);
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
        // الترحيل A5 (H3-01c) يُختبر في PaymentRefundPostingTest؛ هنا تُعزل دورة الحياة عن القيد.
        Event::fake([PaymentRefundConfirmed::class]);
    }

    // ───────────────────────── المسار السعيد ─────────────────────────

    #[Test]
    public function a_full_refund_runs_request_approve_submit_confirm_without_touching_the_ledger(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $entriesBefore = JournalEntry::query()->count();

        $refund = $this->refunds->request($attempt, 115000, $this->alloc($note, 115000), 'idem-full-0001', $this->owner);
        $this->assertSame(PaymentRefund::REQUESTED, $refund->status);
        $this->assertStringStartsWith('PRF-2026-', $refund->number);
        $this->assertSame($this->customer->id, $refund->partner_id);
        $this->assertSame($attempt->branch_id, $refund->branch_id);

        $approved = $this->refunds->approve($refund, $this->admin);
        $this->assertSame(PaymentRefund::APPROVED, $approved->status);
        $this->assertSame($this->admin->id, $approved->approved_by);

        $done = $this->refunds->submit($approved, $this->admin);
        $this->assertSame(PaymentRefund::CONFIRMED, $done->status);
        $this->assertSame(PaymentRefund::POSTING_PENDING, $done->posting_status);
        $this->assertSame(115000, $done->provider_refunded_minor);
        $this->assertNotNull($done->confirmed_at);
        $this->assertNotNull($done->provider_refunded_at);
        $this->assertNull($done->journal_entry_id);
        $this->assertSame(115000, $attempt->fresh()->refunded_minor);
        $this->assertCount(1, $this->fake->refundCalls);

        $invocation = PaymentRefundAttempt::query()->sole();
        $this->assertSame(0, $invocation->baseline_refunded_minor);
        $this->assertSame(PaymentRefundAttemptResult::OUTCOME_CONFIRMED, PaymentRefundAttemptResult::query()->sole()->outcome);
        $this->assertEqualsCanonicalizing(['requested', 'approved', 'submitting', 'confirmed'], $this->actions($refund));
        $this->assertSame($entriesBefore, JournalEntry::query()->count(), 'لا قيد من هذه الشريحة');
    }

    #[Test]
    public function two_partial_refunds_reserve_and_consume_the_payment_capacity_without_double_counting(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();

        $first = $this->refunds->request($attempt, 40000, $this->alloc($note, 40000), 'idem-part-0001', $this->owner);
        $this->assertSame(75000, $this->refunds->refundablePayment($attempt->fresh()), 'المحجوز غير المؤكَّد يُخصم');
        $this->refunds->approve($first, $this->admin);
        $first = $this->refunds->submit($first->fresh(), $this->admin);
        $this->assertSame(PaymentRefund::CONFIRMED, $first->status);
        $this->assertSame(75000, $this->refunds->refundablePayment($attempt->fresh()), 'المؤكَّد داخل refunded_minor فلا يُخصم مرتين');

        $spare = $this->creditNote();   // مصدر آخر كافٍ: الحدّ هنا متبقي الدفعة لا رصيد المصدر
        $e = $this->thrown(fn () => $this->refunds->request($attempt->fresh(), 75001, $this->alloc($spare, 75001), 'idem-part-0002', $this->owner), 'over capacity', PaymentRefundException::class);
        $this->assertSame('exceeds_payment_capacity', $e->reason);

        $second = $this->refunds->request($attempt->fresh(), 75000, $this->alloc($note, 75000), 'idem-part-0003', $this->owner);
        $this->refunds->approve($second, $this->admin);
        $second = $this->refunds->submit($second->fresh(), $this->admin);
        $this->assertSame(PaymentRefund::CONFIRMED, $second->status);
        $this->assertSame(115000, $attempt->fresh()->refunded_minor);
        $this->assertSame(0, $this->refunds->refundablePayment($attempt->fresh()));
        $this->assertCount(2, $this->fake->refundCalls);
    }

    // ───────────────────────── الفصل والصلاحيات ─────────────────────────

    #[Test]
    public function the_requester_can_never_approve_their_own_refund_even_as_the_only_owner(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->refunds->request($attempt, 115000, $this->alloc($note, 115000), 'idem-self-0001', $this->owner);

        $e = $this->thrown(fn () => $this->refunds->approve($refund, $this->owner), 'self approval', PaymentRefundException::class);
        $this->assertSame('self_approval', $e->reason);
        $e = $this->thrown(fn () => $this->refunds->reject($refund, $this->owner, 'رفض ذاتي'), 'self reject', PaymentRefundException::class);
        $this->assertSame('self_approval', $e->reason);
        $this->assertSame(PaymentRefund::REQUESTED, $refund->fresh()->status);

        // القاعدة تفرضه أيضاً: لا اعتماد بنفس الطالب ولا حالة ما بعد الموافقة بلا معتمِد.
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $refund->id)->update(['status' => 'approved', 'approved_by' => $this->owner->id, 'approved_at' => now()])), 'db self approval', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $refund->id)->update(['status' => 'approved'])), 'db approved without approver', QueryException::class);
        $this->assertSame(PaymentRefund::REQUESTED, $refund->fresh()->status);
    }

    #[Test]
    public function only_authorised_active_users_can_request_and_approve(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $accountant = User::create(['tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'acc@pay-h3-01b.test', 'password' => 'password123', 'role' => 'accountant']);

        $e = $this->thrown(fn () => $this->refunds->request($attempt, 115000, $this->alloc($note, 115000), 'idem-perm-0001', $accountant), 'accountant request', PaymentRefundException::class);
        $this->assertSame('forbidden', $e->reason);

        $refund = $this->refunds->request($attempt, 115000, $this->alloc($note, 115000), 'idem-perm-0002', $this->owner);
        $e = $this->thrown(fn () => $this->refunds->approve($refund, $accountant), 'accountant approve', PaymentRefundException::class);
        $this->assertSame('forbidden', $e->reason);

        $stale = $this->admin;
        DB::table('users')->where('id', $stale->id)->update(['is_active' => false]);
        $e = $this->thrown(fn () => $this->refunds->approve($refund, $stale), 'inactive approver', PaymentRefundException::class);
        $this->assertSame('forbidden', $e->reason);
        $this->assertSame(PaymentRefund::REQUESTED, $refund->fresh()->status);
    }

    #[Test]
    public function the_four_permissions_are_owner_admin_only_and_assignable(): void
    {
        foreach (['payment_refunds.view', 'payment_refunds.request', 'payment_refunds.approve', 'payment_refunds.resolve_unknown'] as $permission) {
            $this->assertTrue(Rbac::allows('owner', $permission), $permission);
            $this->assertTrue(Rbac::allows('admin', $permission), $permission);
            $this->assertFalse(Rbac::allows('accountant', $permission), $permission);
            $this->assertFalse(Rbac::allows('staff', $permission), $permission);
            $this->assertContains($permission, Rbac::PERMISSIONS);
        }
    }

    // ───────────────────────── الأهلية والسقوف ─────────────────────────

    #[Test]
    public function eligibility_rejects_unposted_captures_disputes_flags_wrong_partner_and_bad_allocations(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $other = Partner::create(['name' => 'عميل آخر', 'type' => 'customer']);
        $foreignNote = $this->creditNote($other);

        $cases = [
            'partner_mismatch' => fn () => $this->refunds->request($attempt, 115000, $this->alloc($foreignNote, 115000), 'idem-elig-0001', $this->owner),
            'exceeds_source_balance' => fn () => $this->refunds->request($attempt, 115001, $this->alloc($note, 115001), 'idem-elig-0002', $this->owner),
            'invalid_allocations' => fn () => $this->refunds->request($attempt, 115000, $this->alloc($note, 100000), 'idem-elig-0003', $this->owner),
            'invalid_amount' => fn () => $this->refunds->request($attempt, 0, $this->alloc($note, 1), 'idem-elig-0004', $this->owner),
            'invalid_idempotency_key' => fn () => $this->refunds->request($attempt, 1000, $this->alloc($note, 1000), 'x', $this->owner),
        ];
        foreach ($cases as $reason => $operation) {
            $e = $this->thrown($operation, $reason, PaymentRefundException::class);
            $this->assertSame($reason, $e->reason);
        }

        DB::table('payment_attempts')->where('id', $attempt->id)->update(['dispute_status' => 'open']);
        $e = $this->thrown(fn () => $this->refunds->request($attempt->fresh(), 1000, $this->alloc($note, 1000), 'idem-elig-0005', $this->owner), 'dispute', PaymentRefundException::class);
        $this->assertSame('dispute_active', $e->reason);
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['dispute_status' => 'won']);
        $this->assertSame(PaymentRefund::REQUESTED, $this->refunds->request($attempt->fresh(), 1000, $this->alloc($note, 1000), 'idem-elig-0006', $this->owner)->status, 'بعد كسب النزاع يُسمح');

        $this->assertSame(1, PaymentRefund::query()->count(), 'لا أثر لأي رفض');
    }

    #[Test]
    public function a_capture_that_was_never_posted_cannot_be_refunded(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['posting_status' => 'blocked_period']);

        $e = $this->thrown(fn () => $this->refunds->request($attempt->fresh(), 1000, $this->alloc($note, 1000), 'idem-unposted-1', $this->owner), 'unposted', PaymentRefundException::class);
        $this->assertSame('capture_not_posted', $e->reason);
    }

    #[Test]
    public function the_rollout_gate_blocks_request_approve_and_submit(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->refunds->request($attempt, 115000, $this->alloc($note, 115000), 'idem-gate-0001', $this->owner);
        $approved = $this->refunds->approve($refund, $this->admin);

        app(PaymentsRolloutControlService::class)->setPlatformState($this->platform, false, 'إيقاف طارئ للاختبار');
        foreach ([
            fn () => $this->refunds->request($attempt, 1000, $this->alloc($note, 1000), 'idem-gate-0002', $this->owner),
            fn () => $this->refunds->approve($approved, $this->admin),
            fn () => $this->refunds->submit($approved, $this->admin),
        ] as $operation) {
            $e = $this->thrown($operation, 'platform stop', PaymentRefundException::class);
            $this->assertSame('platform_stop', $e->reason);
        }
        $this->assertSame([], $this->fake->refundCalls, 'لا استدعاء للمزوّد أثناء الإيقاف الطارئ');
        $this->assertSame(PaymentRefund::APPROVED, $approved->fresh()->status);
    }

    // ───────────────────────── الرصيد المشترك مع الاسترداد النقدي ─────────────────────────

    #[Test]
    public function the_source_balance_is_shared_with_cash_refunds_in_both_directions(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();   // 115000
        $cash = app(CustomerRefundService::class);

        // اتجاه 1: احتجاز البوابة يخفض ما يستطيع النقدي استرداده.
        $gateway = $this->refunds->request($attempt, 100000, $this->alloc($note, 100000), 'idem-share-0001', $this->owner);
        $this->assertSame(15000, $cash->refundableBalance($note->fresh()));
        $e = $this->thrown(fn () => $cash->create(['partner_id' => $this->customer->id, 'amount' => 20000, 'method' => 'cash'], [['source_type' => 'credit_note', 'source_id' => $note->id, 'amount' => 20000]]), 'cash over', RuntimeException::class);
        $this->assertStringContainsString('يتجاوز', $e->getMessage());

        // اتجاه 2: النقدي المرحّل يخفض ما تستطيع البوابة طلبه.
        $refund = $cash->create(['partner_id' => $this->customer->id, 'amount' => 15000, 'method' => 'cash'], [['source_type' => 'credit_note', 'source_id' => $note->id, 'amount' => 15000]]);
        $cash->post($refund);
        $e = $this->thrown(fn () => $this->refunds->request($attempt, 1000, $this->alloc($note, 1000), 'idem-share-0002', $this->owner), 'gateway over', PaymentRefundException::class);
        $this->assertSame('exceeds_source_balance', $e->reason);

        // المرفوض/الملغى يفرج الاحتجاز.
        $this->refunds->cancel($gateway, $this->owner, 'إلغاء من الطالب');
        $this->assertSame(100000, $cash->refundableBalance($note->fresh()));
        $this->assertSame(1, CustomerRefund::query()->where('status', 'posted')->count());
    }

    #[Test]
    public function approval_revalidation_excludes_the_refund_itself(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->refunds->request($attempt, 115000, $this->alloc($note, 115000), 'idem-self-excl1', $this->owner);

        $this->assertSame(PaymentRefund::APPROVED, $this->refunds->approve($refund, $this->admin)->status, 'استرداد كامل لا يُرفض بحجزه نفسه');
    }

    // ───────────────────────── منع التكرار ─────────────────────────

    #[Test]
    public function the_idempotency_key_replays_the_same_request_and_rejects_a_different_one(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $first = $this->refunds->request($attempt, 50000, $this->alloc($note, 50000), 'idem-replay-001', $this->owner);

        $again = $this->refunds->request($attempt, 50000, $this->alloc($note, 50000), 'idem-replay-001', $this->owner);
        $this->assertSame($first->id, $again->id);
        $this->assertSame(1, PaymentRefund::query()->count());

        $e = $this->thrown(fn () => $this->refunds->request($attempt, 60000, $this->alloc($note, 60000), 'idem-replay-001', $this->owner), 'conflict', PaymentRefundException::class);
        $this->assertSame('idempotency_conflict', $e->reason);
    }

    // ───────────────────────── المزوّد: فشل/غير معروف/مطابقة ─────────────────────────

    #[Test]
    public function a_provider_rejection_fails_the_refund_without_any_residual_reservation(): void
    {
        [$attempt, $note, $approved] = $this->approvedRefund(115000);
        $this->fake->failNextRefund('rejected');

        $failed = $this->refunds->submit($approved, $this->admin);

        $this->assertSame(PaymentRefund::FAILED, $failed->status);
        $this->assertSame(0, $attempt->fresh()->refunded_minor);
        $this->assertSame(115000, $this->refunds->refundablePayment($attempt->fresh()), 'الحصّة محرَّرة');
        $this->assertSame(PaymentRefundAttemptResult::OUTCOME_REJECTED, PaymentRefundAttemptResult::query()->sole()->outcome);
        $this->assertSame(1, count($this->fake->refundCalls));
    }

    #[Test]
    public function an_unknown_outcome_blocks_further_submissions_and_a_not_applied_proof_allows_one_retry(): void
    {
        [$attempt, $note, $approved] = $this->approvedRefund(40000);
        $this->fake->failNextRefund('unknown_not_applied');

        $unknown = $this->refunds->submit($approved, $this->admin);
        $this->assertSame(PaymentRefund::UNKNOWN, $unknown->status);
        $this->assertSame(0, $attempt->fresh()->refunded_minor);

        // الاسترداد الثاني على الدفعة نفسها محجوب (إرسال واحد في الطيران).
        $other = $this->refunds->request($attempt->fresh(), 10000, $this->alloc($note, 10000), 'idem-unk-other1', $this->owner);
        $other = $this->refunds->approve($other, $this->admin);
        $e = $this->thrown(fn () => $this->refunds->submit($other, $this->admin), 'busy', PaymentRefundException::class);
        $this->assertSame('busy', $e->reason);

        // المطابِقة: observed = baseline ⇒ لم يُطبَّق ⇒ إعادة واحدة (unknown → approved).
        $this->assertSame('too_early', $this->refunds->reconcileUnknown($unknown));
        $this->assertSame('retry_scheduled', $this->refunds->reconcileUnknown($unknown, 0));
        $retry = $unknown->fresh();
        $this->assertSame(PaymentRefund::APPROVED, $retry->status);
        $this->assertSame(1, $retry->retry_count);

        $done = $this->refunds->submit($retry, $this->admin);
        $this->assertSame(PaymentRefund::CONFIRMED, $done->status);
        $this->assertSame(2, PaymentRefundAttempt::query()->where('payment_refund_id', $done->id)->count());
        $this->assertSame(40000, $attempt->fresh()->refunded_minor);
    }

    #[Test]
    public function an_applied_but_unanswered_refund_is_never_auto_confirmed_and_needs_a_human_decision(): void
    {
        [$attempt, , $approved] = $this->approvedRefund(40000);
        $this->fake->failNextRefund('unknown_applied');

        $unknown = $this->refunds->submit($approved, $this->admin);
        $this->assertSame(PaymentRefund::UNKNOWN, $unknown->status);

        $this->assertSame('probable_applied', $this->refunds->reconcileUnknown($unknown, 0));
        $this->assertSame(PaymentRefund::UNKNOWN, $unknown->fresh()->status, 'لا تأكيد آلي بمجرد تساوي الفرق');
        $this->assertSame(0, $attempt->fresh()->refunded_minor);

        // الحسم البشري يتطلب الصلاحية والسبب والدليل.
        $accountant = User::create(['tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'acc2@pay-h3-01b.test', 'password' => 'password123', 'role' => 'accountant']);
        $e = $this->thrown(fn () => $this->refunds->resolveUnknown($unknown, $accountant, 'confirm', 'هذا استردادنا فعلاً'), 'forbidden', PaymentRefundException::class);
        $this->assertSame('forbidden', $e->reason);
        $e = $this->thrown(fn () => $this->refunds->resolveUnknown($unknown, $this->admin, 'confirm', 'abc'), 'short reason', PaymentRefundException::class);
        $this->assertSame('reason_required', $e->reason);

        $confirmed = $this->refunds->resolveUnknown($unknown, $this->admin, 'confirm', 'هذا استردادنا فعلاً');
        $this->assertSame(PaymentRefund::CONFIRMED, $confirmed->status);
        $this->assertSame(40000, $attempt->fresh()->refunded_minor);
        $this->assertSame(PaymentRefund::POSTING_PENDING, $confirmed->posting_status);
        $this->assertSame(1, count($this->fake->refundCalls), 'لا إعادة إرسال أعمى');
    }

    #[Test]
    public function a_human_not_applied_decision_fails_the_refund_and_flags_an_external_increase(): void
    {
        [$attempt, , $approved] = $this->approvedRefund(40000);
        $this->fake->failNextRefund('unknown_not_applied');
        $unknown = $this->refunds->submit($approved, $this->admin);
        $this->fake->scriptRefunded($attempt->provider_payment_id, 40000);   // استرداد من لوحة المزوّد بالمبلغ نفسه

        $failed = $this->refunds->resolveUnknown($unknown, $this->admin, 'not_applied', 'استرداد من لوحة المزوّد وليس منا');

        $this->assertSame(PaymentRefund::FAILED, $failed->status);
        $flagged = $attempt->fresh();
        $this->assertNotNull($flagged->unrecognized_refund_at);
        $this->assertSame(40000, $flagged->unrecognized_refund_minor);
        $this->assertSame(0, $flagged->refunded_minor, 'لا يُكتب المحلي من المزوّد');
    }

    #[Test]
    public function a_confirm_decision_with_an_excess_over_baseline_plus_amount_flags_the_difference(): void
    {
        [$attempt, , $approved] = $this->approvedRefund(40000);
        $this->fake->failNextRefund('unknown_applied');
        $unknown = $this->refunds->submit($approved, $this->admin);
        $this->fake->scriptRefunded($attempt->provider_payment_id, 55000);   // 40000 منا + 15000 خارجي

        $confirmed = $this->refunds->resolveUnknown($unknown, $this->admin, 'confirm', 'استردادنا مع فائض خارجي');

        $this->assertSame(15000, $confirmed->excess_minor);
        $this->assertSame(40000, $attempt->fresh()->refunded_minor, 'المعترَف به المفسَّر فقط');
        $this->assertSame(55000, $attempt->fresh()->unrecognized_refund_minor);
        $this->assertSame(15000, PaymentRefundAttemptResult::query()->where('outcome', 'confirmed')->sole()->excess_minor);
    }

    // ───────────────────────── الأساس القديم والاسترداد الخارجي ─────────────────────────

    #[Test]
    public function a_stale_baseline_stops_the_submission_flags_the_payment_and_blocks_further_requests(): void
    {
        [$attempt, $note, $approved] = $this->approvedRefund(40000);
        $this->fake->scriptRefunded($attempt->provider_payment_id, 20000);   // استرداد خارجي بعد آخر مزامنة

        $e = $this->thrown(fn () => $this->refunds->submit($approved, $this->admin), 'stale baseline', PaymentRefundException::class);

        $this->assertSame('unrecognized_refund_open', $e->reason);
        $this->assertSame([], $this->fake->refundCalls, 'لا استدعاء للمزوّد');
        $this->assertSame(PaymentRefund::APPROVED, $approved->fresh()->status);
        $this->assertNotNull($attempt->fresh()->unrecognized_refund_at);
        $this->assertSame(0, $attempt->fresh()->refunded_minor);

        $e = $this->thrown(fn () => $this->refunds->request($attempt->fresh(), 1000, $this->alloc($note, 1000), 'idem-stale-0002', $this->owner), 'blocked', PaymentRefundException::class);
        $this->assertSame('unrecognized_refund_open', $e->reason);
    }

    #[Test]
    public function resolving_the_external_refund_syncs_the_total_and_cancels_pending_documents_atomically(): void
    {
        [$attempt, $note, $approved] = $this->approvedRefund(40000);
        $second = $this->refunds->request($attempt->fresh(), 10000, $this->alloc($note, 10000), 'idem-resolve-02', $this->owner);
        $this->fake->scriptRefunded($attempt->provider_payment_id, 20000);
        $this->thrown(fn () => $this->refunds->submit($approved, $this->admin), 'stale', PaymentRefundException::class);

        $accountant = User::create(['tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'acc3@pay-h3-01b.test', 'password' => 'password123', 'role' => 'accountant']);
        $e = $this->thrown(fn () => $this->refunds->resolveExternalRefund($attempt, $accountant, 'مزامنة بعد المراجعة'), 'forbidden', PaymentRefundException::class);
        $this->assertSame('forbidden', $e->reason);

        $resolved = $this->refunds->resolveExternalRefund($attempt, $this->admin, 'راجعنا الاسترداد الخارجي');

        $this->assertNull($resolved->unrecognized_refund_at);
        $this->assertSame(20000, $resolved->refunded_minor);
        foreach ([$approved, $second] as $pending) {
            $fresh = $pending->fresh();
            $this->assertSame(PaymentRefund::CANCELLED, $fresh->status);
            $this->assertSame('external_refund_resolved', $fresh->cancel_reason);
            $this->assertSame($this->admin->id, $fresh->cancelled_by, 'الحاسم لا الطالب');
        }
        $this->assertSame('external_refund_resolved', PaymentRefundEvent::query()->whereNull('payment_refund_id')->where('action', 'external_refund_resolved')->sole()->action);
        $e = $this->thrown(fn () => $this->refunds->resolveExternalRefund($attempt, $this->admin, 'مرة ثانية بلا علم'), 'no flag', PaymentRefundException::class);
        $this->assertSame('no_unrecognized_refund', $e->reason);

        // الطلب الجديد يرى السعة الجديدة (115000 − 20000).
        $e = $this->thrown(fn () => $this->refunds->request($attempt->fresh(), 95001, $this->alloc($note, 95001), 'idem-resolve-03', $this->owner), 'capacity', PaymentRefundException::class);
        $this->assertSame('exceeds_payment_capacity', $e->reason);
    }

    #[Test]
    public function an_ordinary_sync_never_writes_refunded_minor_and_flags_unexplained_increases_only(): void
    {
        $attempt = $this->postedCapture();
        $this->fake->scriptRefunded($attempt->provider_payment_id, 30000);

        $this->orchestrator->sync($attempt);

        $fresh = $attempt->fresh();
        $this->assertSame(0, $fresh->refunded_minor);
        $this->assertNotNull($fresh->unrecognized_refund_at);
        $this->assertSame(30000, $fresh->unrecognized_refund_minor);
        $this->assertSame('external_refund_flagged', PaymentRefundEvent::query()->whereNull('payment_refund_id')->sole()->action);

        // لقطة مساوية/أقل لا أثر لها.
        $this->orchestrator->sync($attempt->fresh());
        $this->assertSame(1, PaymentRefundEvent::query()->count());
    }

    #[Test]
    public function a_sync_during_an_in_flight_refund_does_not_flag_it(): void
    {
        [$attempt, , $approved] = $this->approvedRefund(40000);
        $this->fake->failNextRefund('unknown_applied');
        $this->refunds->submit($approved, $this->admin);   // unknown (نُفِّذ ثم ضاع الردّ)

        $this->orchestrator->sync($attempt->fresh());

        $this->assertNull($attempt->fresh()->unrecognized_refund_at, 'يفسّره الاسترداد الداخلي قيد الطيران');
    }

    #[Test]
    public function an_orphaned_submission_without_an_invocation_record_returns_to_approved(): void
    {
        [, , $approved] = $this->approvedRefund(40000);
        PaymentRefund::query()->whereKey($approved->id)->first()->forceFill(['status' => PaymentRefund::SUBMITTING])->save();

        $this->assertSame('skipped', $this->refunds->recoverOrphanedSubmission($approved, 10), 'داخل المهلة');
        $this->assertSame('returned_to_approved', $this->refunds->recoverOrphanedSubmission($approved, 0));
        $this->assertSame(PaymentRefund::APPROVED, $approved->fresh()->status);
        $this->assertSame([], $this->fake->refundCalls);
    }

    #[Test]
    public function a_retry_whose_baseline_fetch_never_recorded_an_invocation_is_not_stuck_in_submitting(): void
    {
        [$attempt, , $approved] = $this->approvedRefund(40000);
        $this->fake->failNextRefund('unknown_not_applied');
        $unknown = $this->refunds->submit($approved, $this->admin);
        $this->assertSame('retry_scheduled', $this->refunds->reconcileUnknown($unknown, 0));
        $retry = $unknown->fresh();
        $this->assertSame(1, $retry->retry_count);
        $this->assertSame(1, PaymentRefundAttempt::query()->where('payment_refund_id', $retry->id)->count());

        // التقديم الثاني حجز الخانة ثم انهار قبل تسجيل استدعائه: سجل التقديم الأول لا يُعدّ دليلاً على إرسال الحالي.
        $retry->forceFill(['status' => PaymentRefund::SUBMITTING])->save();

        $this->assertSame('returned_to_approved', $this->refunds->recoverOrphanedSubmission($retry, 0));
        $this->assertSame(PaymentRefund::APPROVED, $retry->fresh()->status);
        $this->assertSame(0, $attempt->fresh()->refunded_minor);
    }

    #[Test]
    public function a_crash_between_the_invocation_record_and_the_result_becomes_unknown_and_is_resolvable(): void
    {
        [$attempt, , $approved] = $this->approvedRefund(40000);
        PaymentRefund::query()->whereKey($approved->id)->first()->forceFill(['status' => PaymentRefund::SUBMITTING])->save();
        PaymentRefundAttempt::query()->create(['payment_refund_id' => $approved->id, 'seq' => 1, 'baseline_refunded_minor' => 0, 'amount_minor' => 40000]);

        $this->assertSame('marked_unknown', $this->refunds->recoverOrphanedSubmission($approved, 0));

        $unknown = $approved->fresh();
        $this->assertSame(PaymentRefund::UNKNOWN, $unknown->status);
        $this->assertSame('worker_lost', PaymentRefundAttemptResult::query()->sole()->error_code);
        $this->assertSame('skipped', $this->refunds->recoverOrphanedSubmission($unknown, 0), 'لا تكرار');
        // الآن يدخل مسار المطابقة العادي: observed = baseline ⇒ لم يُطبَّق ⇒ إعادة واحدة.
        $this->assertSame('retry_scheduled', $this->refunds->reconcileUnknown($unknown, 0));
        $this->assertSame(0, $attempt->fresh()->refunded_minor);
    }

    #[Test]
    public function an_unresolved_unknown_refund_rotates_so_the_reconciler_does_not_starve_others(): void
    {
        [, , $approved] = $this->approvedRefund(40000);
        $this->fake->failNextRefund('unknown_applied');
        $unknown = $this->refunds->submit($approved, $this->admin);
        $before = $unknown->fresh()->updated_at;
        $this->travel(5)->minutes();

        $this->assertSame('probable_applied', $this->refunds->reconcileUnknown($unknown, 0));

        $this->assertTrue($unknown->fresh()->updated_at->gt($before), 'يدور المصنَّف بلا تغيير حالة إلى آخر الطابور');
    }

    #[Test]
    public function the_scheduled_reconciler_handles_unknown_and_orphaned_refunds_across_tenants_without_confirming(): void
    {
        [$attemptA, , $approvedA] = $this->approvedRefund(40000);
        $this->fake->failNextRefund('unknown_not_applied');
        $unknownA = $this->refunds->submit($approvedA, $this->admin);
        [, , $approvedB] = $this->approvedRefund(10000);
        PaymentRefund::query()->whereKey($approvedB->id)->first()->forceFill(['status' => PaymentRefund::SUBMITTING])->save();
        app(TenantContext::class)->forget();

        $summary = app(\App\Services\PaymentRefundReconciler::class)->run(100, 0, 0);

        $this->assertSame(1, $summary['unknown']);
        $this->assertSame(1, $summary['retry_scheduled']);
        $this->assertSame(1, $summary['orphans']);
        $this->assertSame(1, $summary['recovered']);
        $this->assertSame(0, $summary['marked_unknown']);
        $this->assertSame(0, $summary['failed']);
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(PaymentRefund::APPROVED, $unknownA->fresh()->status);
        $this->assertSame(PaymentRefund::APPROVED, $approvedB->fresh()->status);
        $this->assertSame(0, PaymentRefund::query()->where('status', PaymentRefund::CONFIRMED)->count(), 'لا تأكيد آلي');
        $this->assertSame(1, count($this->fake->refundCalls), 'لا إرسال من المطابِق');
        $this->assertSame(0, $attemptA->fresh()->refunded_minor);
        $this->assertSame(0, \Illuminate\Support\Facades\Artisan::call('payments:reconcile-refunds'));
    }

    // ───────────────────────── حراس القاعدة والنموذج ─────────────────────────

    #[Test]
    public function the_database_enforces_transitions_frozen_fields_and_the_single_in_flight_slot(): void
    {
        [$attempt, $note, $approved] = $this->approvedRefund(40000);

        // انتقال غير مشروع (approved → confirmed) وتعديل حقل مجمَّد.
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $approved->id)->update(['status' => 'confirmed', 'confirmed_at' => now(), 'provider_refunded_minor' => 1, 'posting_status' => 'pending'])), 'illegal transition', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $approved->id)->update(['amount_minor' => 1])), 'frozen amount', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $approved->id)->update(['approved_by' => $this->owner->id])), 'approver change', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $approved->id)->delete()), 'delete', QueryException::class);

        // خانة إرسال واحدة لكل دفعة.
        $second = $this->refunds->request($attempt->fresh(), 10000, $this->alloc($note, 10000), 'idem-slot-0002', $this->owner);
        $second = $this->refunds->approve($second, $this->admin);
        DB::table('payment_refunds')->where('id', $approved->id)->update(['status' => 'submitting']);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $second->id)->update(['status' => 'submitting'])), 'second in flight', QueryException::class);
    }

    #[Test]
    public function the_database_requires_allocations_to_sum_to_the_amount_at_approval_and_freezes_them_afterwards(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->refunds->request($attempt, 50000, $this->alloc($note, 50000), 'idem-sum-00001', $this->owner);
        $allocation = PaymentRefundAllocation::query()->sole();

        // مسار الخدمة يضمن الـΣ؛ تجاوز مباشر للنموذج لا يمرّ من القاعدة: لا تخصيص ثانٍ بعد الاعتماد ولا تعديل/حذف.
        $this->refunds->approve($refund, $this->admin);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refund_allocations')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenant->id, 'payment_refund_id' => $refund->id,
            'source_type' => CreditNote::class, 'source_id' => (string) \Illuminate\Support\Str::uuid(), 'amount_minor' => 1, 'created_at' => now(), 'updated_at' => now(),
        ])), 'late allocation', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refund_allocations')->where('id', $allocation->id)->update(['amount_minor' => 1])), 'update', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refund_allocations')->where('id', $allocation->id)->delete()), 'delete', QueryException::class);
        $this->thrown(fn () => $allocation->update(['amount_minor' => 1]), 'model update', LogicException::class);

        // اعتماد بمجموع مخالف مرفوض في القاعدة (استرداد جديد بتخصيص ناقص يُدرج مباشرة).
        $raw = PaymentRefund::query()->create([
            'number' => 'PRF-RAW-1', 'partner_id' => $this->customer->id, 'payment_attempt_id' => $attempt->id, 'payment_gateway_id' => $this->gateway->id,
            'amount_minor' => 30000, 'currency' => 'SAR', 'idempotency_key' => 'idem-sum-raw-001', 'requested_by' => $this->owner->id, 'requested_at' => now(),
        ]);
        PaymentRefundAllocation::query()->create(['payment_refund_id' => $raw->id, 'source_type' => CreditNote::class, 'source_id' => $note->id, 'amount_minor' => 10000]);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_refunds')->where('id', $raw->id)->update(['status' => 'approved', 'approved_by' => $this->admin->id, 'approved_at' => now()])), 'sum mismatch', QueryException::class);
    }

    #[Test]
    public function invocation_result_and_event_records_are_append_only(): void
    {
        [, , $approved] = $this->approvedRefund(40000);
        $this->refunds->submit($approved, $this->admin);

        foreach ([PaymentRefundAttempt::query()->sole(), PaymentRefundAttemptResult::query()->sole(), PaymentRefundEvent::query()->first()] as $record) {
            $this->thrown(fn () => $record->forceFill(['created_at' => now()->addDay()])->save(), 'model update', LogicException::class);
            $this->thrown(fn () => $record->delete(), 'model delete', LogicException::class);
        }
        foreach (['payment_refund_attempts', 'payment_refund_attempt_results', 'payment_refund_events'] as $table) {
            $id = DB::table($table)->value('id');
            $this->thrown(fn () => DB::transaction(fn () => DB::table($table)->where('id', $id)->delete()), "delete {$table}", QueryException::class);
        }
    }

    #[Test]
    public function a_second_final_result_for_one_invocation_is_refused(): void
    {
        [, , $approved] = $this->approvedRefund(40000);
        $this->refunds->submit($approved, $this->admin);
        $invocation = PaymentRefundAttempt::query()->sole();

        $this->thrown(fn () => PaymentRefundAttemptResult::query()->create(['payment_refund_attempt_id' => $invocation->id, 'outcome' => 'rejected', 'error_code' => 'dup']), 'second final', QueryException::class);
    }

    #[Test]
    public function another_tenant_cannot_reach_this_tenants_refunds_attempts_or_sources(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->refunds->request($attempt, 40000, $this->alloc($note, 40000), 'idem-iso-00001', $this->owner);

        $other = Tenant::create(['name' => 'مستأجر آخر', 'slug' => 'pay-h3-01b-b', 'vat_number' => '300000000000023', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $this->assertSame(0, PaymentRefund::query()->count());
        $this->assertNull(PaymentRefund::query()->find($refund->id));
        $this->thrown(fn () => PaymentRefund::query()->create([
            'tenant_id' => $this->tenant->id, 'number' => 'PRF-X', 'partner_id' => $this->customer->id, 'payment_attempt_id' => $attempt->id,
            'payment_gateway_id' => $this->gateway->id, 'amount_minor' => 1, 'currency' => 'SAR', 'idempotency_key' => 'idem-forged-001',
            'requested_by' => $this->owner->id, 'requested_at' => now(),
        ]), 'forged tenant', \DomainException::class);
        $this->thrown(fn () => PaymentRefund::query()->create([
            'number' => 'PRF-Y', 'partner_id' => $this->customer->id, 'payment_attempt_id' => $attempt->id,
            'payment_gateway_id' => $this->gateway->id, 'amount_minor' => 1, 'currency' => 'SAR', 'idempotency_key' => 'idem-forged-002',
            'requested_by' => $this->owner->id, 'requested_at' => now(),
        ]), 'foreign references', \DomainException::class);

        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(1, PaymentRefund::query()->count());
    }

    #[Test]
    public function deleting_a_tenant_with_refund_records_cascades_cleanly(): void
    {
        // سجلات الاسترداد مباشرةً (مصدر وهمي بلا إشعار دائن: حذف مستأجر بقيود إشعار دائن مرحَّل قيدٌ قائم لا علاقة له بهذه الجداول).
        $attempt = $this->postedCapture();
        $refund = PaymentRefund::query()->create([
            'number' => 'PRF-CASCADE-1', 'partner_id' => $this->customer->id, 'payment_attempt_id' => $attempt->id, 'payment_gateway_id' => $this->gateway->id,
            'amount_minor' => 1000, 'currency' => 'SAR', 'idempotency_key' => 'idem-cascade-001', 'requested_by' => $this->owner->id, 'requested_at' => now(),
        ]);
        PaymentRefundAllocation::query()->create(['payment_refund_id' => $refund->id, 'source_type' => CreditNote::class, 'source_id' => (string) \Illuminate\Support\Str::uuid(), 'amount_minor' => 1000]);
        $refund->forceFill(['status' => PaymentRefund::APPROVED, 'approved_by' => $this->admin->id, 'approved_at' => now()])->save();
        $refund->forceFill(['status' => PaymentRefund::SUBMITTING])->save();
        $invocation = PaymentRefundAttempt::query()->create(['payment_refund_id' => $refund->id, 'seq' => 1, 'baseline_refunded_minor' => 0, 'amount_minor' => 1000]);
        PaymentRefundAttemptResult::query()->create(['payment_refund_attempt_id' => $invocation->id, 'outcome' => 'unknown', 'error_code' => 'timeout']);
        PaymentRefundEvent::query()->create(['payment_refund_id' => $refund->id, 'payment_attempt_id' => $attempt->id, 'action' => 'unknown']);
        $this->assertSame(1, DB::table('payment_refunds')->count());

        DB::table('tenants')->where('id', $this->tenant->id)->delete();

        foreach (['payment_refunds', 'payment_refund_allocations', 'payment_refund_attempts', 'payment_refund_attempt_results', 'payment_refund_events'] as $table) {
            $this->assertSame(0, DB::table($table)->count(), $table);
        }
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @return list<string> */
    private function actions(PaymentRefund $refund): array
    {
        return PaymentRefundEvent::query()->where('payment_refund_id', $refund->id)->pluck('action')->all();
    }

    /** @return list<array{source_type: string, source_id: string, amount: int}> */
    private function alloc(CreditNote $note, int $amount): array
    {
        return [['source_type' => CustomerRefundService::SOURCE_CREDIT_NOTE, 'source_id' => $note->id, 'amount' => $amount]];
    }

    private function creditNote(?Partner $customer = null): CreditNote
    {
        $service = app(CreditNoteService::class);
        $note = $service->create(
            ['type' => 'sales', 'partner_id' => ($customer ?? $this->customer)->id, 'refund_type' => 'credit', 'reason' => 'تصحيح تجاري'],
            [['description' => 'تصحيح', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        return $service->post($note);
    }

    /** التقاط 115000 مرحَّل (فاتورة آجلة ← طلب دفع ← التقاط ← قيد A1). */
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

    /** @return array{0: PaymentAttempt, 1: CreditNote, 2: PaymentRefund} */
    private function approvedRefund(int $amount): array
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->refunds->request($attempt, $amount, $this->alloc($note, $amount), 'idem-appr-'.uniqid(), $this->owner);

        return [$attempt, $note, $this->refunds->approve($refund, $this->admin)];
    }
}
