<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentAttemptPostingEvent;
use App\Models\PaymentGateway;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\InvoiceService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentAttemptPostingService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\PaymentOrchestrationException;
use App\Support\Rbac;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H2-02d — معالجة الدفعات المحجوبة بفترة مقفلة (ADR-0006 M5-R1): إعادة ترحيل صريحة بفاعل وسبب، صلاحية `payments.resolve_blocked`
 * (owner/admin)، سجل قرار ثابت، تنبيه جاهزية الإقفال، وعزل المستأجر. القيد الناتج عند النجاح = M1 (مدين 1170 / دائن 1130 + طرف).
 */
class PaymentAttemptRepostTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
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
        $this->tenant = Tenant::create(['name' => 'شركة المحجوب', 'slug' => 'pay-h2-02d', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h2-02d.test', 'password' => 'password123', 'role' => 'owner']);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h2-02d.test', 'password' => 'platform-password-123']);
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

    #[Test]
    public function an_authorised_repost_after_a_formal_reopen_posts_with_the_original_date_and_records_the_decision(): void
    {
        [$attempt, $invoice, $lock] = $this->blockedAttempt();
        app(AccountingPeriodLockService::class)->release($lock['id'], 'فتح رسمي', $this->owner);

        $outcome = $this->posting->repost($attempt, $this->owner, 'فتح الفترة رسمياً بموافقة المدير المالي');

        $this->assertSame('posted', $outcome);
        $attempt->refresh();
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->posting_status);
        $this->assertNull($attempt->posting_blocked_reason);
        $this->assertSame('2026-10-23', $attempt->accounting_date->toDateString());
        $payment = Payment::query()->sole();
        $this->assertSame('2026-10-23', $payment->payment_date->toDateString());
        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $lines = DB::table('journal_lines')->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->where('journal_lines.journal_entry_id', $payment->journal_entry_id)->orderByDesc('journal_lines.debit')
            ->get(['accounts.code', 'journal_lines.debit', 'journal_lines.credit'])->map(fn ($l) => [$l->code, (int) $l->debit, (int) $l->credit])->all();
        $this->assertSame([['1170', 115000, 0], ['1130', 0, 115000]], $lines);

        $event = PaymentAttemptPostingEvent::query()->sole();
        $this->assertSame($attempt->id, $event->payment_attempt_id);
        $this->assertSame($this->owner->id, $event->actor_id);
        $this->assertSame('posted', $event->outcome);
        $this->assertSame('repost', $event->action);
        $this->assertStringContainsString('المدير المالي', $event->reason);
    }

    #[Test]
    public function a_repost_while_the_period_is_still_locked_stays_blocked_and_is_recorded(): void
    {
        [$attempt] = $this->blockedAttempt();

        $this->assertSame('blocked_period', $this->posting->repost($attempt, $this->owner, 'محاولة قبل فتح الفترة'));

        $this->assertSame(PaymentAttempt::POSTING_BLOCKED_PERIOD, $attempt->fresh()->posting_status);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame('still_blocked', PaymentAttemptPostingEvent::query()->sole()->outcome);
    }

    #[Test]
    public function the_service_rejects_missing_reason_unauthorised_actors_and_non_blocked_attempts(): void
    {
        [$attempt, , $lock] = $this->blockedAttempt();
        app(AccountingPeriodLockService::class)->release($lock['id'], 'فتح رسمي', $this->owner);
        $accountant = User::create(['tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'acc@pay-h2-02d.test', 'password' => 'password123', 'role' => 'accountant']);

        foreach ([['', 'reason_required'], ['abc', 'reason_required']] as [$reason, $code]) {
            $e = $this->thrown(fn () => $this->posting->repost($attempt, $this->owner, $reason), 'bad reason', PaymentOrchestrationException::class);
            $this->assertSame($code, $e->reason);
        }
        $e = $this->thrown(fn () => $this->posting->repost($attempt, $accountant, 'سبب كافٍ للقرار'), 'accountant', PaymentOrchestrationException::class);
        $this->assertSame('forbidden', $e->reason);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, PaymentAttemptPostingEvent::query()->count());

        $this->posting->repost($attempt, $this->owner, 'سبب كافٍ للقرار');
        $e = $this->thrown(fn () => $this->posting->repost($attempt->fresh(), $this->owner, 'مرة ثانية للمرحَّل'), 'already posted', PaymentOrchestrationException::class);
        $this->assertSame('not_blocked', $e->reason);
        $this->assertSame(1, Payment::query()->count(), 'لا سند ثانٍ');
    }

    #[Test]
    public function a_deactivated_actor_loaded_earlier_cannot_repost(): void
    {
        [$attempt] = $this->blockedAttempt();
        $stale = $this->owner;
        DB::table('users')->where('id', $stale->id)->update(['is_active' => false]);

        $e = $this->thrown(fn () => $this->posting->repost($attempt, $stale, 'سبب كافٍ للقرار'), 'inactive actor', PaymentOrchestrationException::class);
        $this->assertSame('forbidden', $e->reason);
    }

    #[Test]
    public function the_posting_events_are_append_only_in_the_model_and_the_database(): void
    {
        [$attempt] = $this->blockedAttempt();
        $this->posting->repost($attempt, $this->owner, 'محاولة أولى للتسجيل');
        $event = PaymentAttemptPostingEvent::query()->sole();

        $this->thrown(fn () => $event->update(['reason' => 'تعديل']), 'model update', LogicException::class);
        $this->thrown(fn () => $event->delete(), 'model delete', LogicException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_attempt_posting_events')->where('id', $event->id)->update(['reason' => 'تعديل'])), 'db update', QueryException::class);
        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_attempt_posting_events')->where('id', $event->id)->delete()), 'db delete', QueryException::class);
        $this->assertSame('محاولة أولى للتسجيل', $event->fresh()->reason);
    }

    #[Test]
    public function the_permission_is_owner_admin_only_and_not_in_any_stored_role(): void
    {
        $this->assertTrue(Rbac::allows('owner', 'payments.resolve_blocked'));
        $this->assertTrue(Rbac::allows('admin', 'payments.resolve_blocked'));
        $this->assertFalse(Rbac::allows('accountant', 'payments.resolve_blocked'));
        $this->assertFalse(Rbac::allows('staff', 'payments.resolve_blocked'));
        $this->assertContains('payments.resolve_blocked', Rbac::PERMISSIONS);
    }

    #[Test]
    public function the_api_lists_blocked_payments_and_reposts_only_for_authorised_roles(): void
    {
        [$attempt, , $lock] = $this->blockedAttempt();
        $token = $this->owner->createToken('t')->plainTextToken;
        $accountant = User::create(['tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'acc2@pay-h2-02d.test', 'password' => 'password123', 'role' => 'accountant'])->createToken('t')->plainTextToken;
        $staff = User::create(['tenant_id' => $this->tenant->id, 'name' => 'موظف', 'email' => 'staff@pay-h2-02d.test', 'password' => 'password123', 'role' => 'staff'])->createToken('t')->plainTextToken;

        $this->withToken($accountant)->getJson('/api/payment-attempts/blocked')->assertForbidden();
        $this->withToken($staff)->postJson("/api/payment-attempts/{$attempt->id}/repost", ['reason' => 'سبب كافٍ'])->assertForbidden();
        $this->withToken($accountant)->postJson("/api/payment-attempts/{$attempt->id}/repost", ['reason' => 'سبب كافٍ'])->assertForbidden();

        $this->withToken($token)->getJson('/api/payment-attempts/blocked')->assertOk()
            ->assertJsonPath('meta.count', 1)->assertJsonPath('data.0.id', $attempt->id)->assertJsonPath('data.0.amount_minor', 115000)
            ->assertJsonPath('data.0.blocked_reason.kind', 'period');

        $this->withToken($token)->postJson("/api/payment-attempts/{$attempt->id}/repost", ['reason' => 'abc'])->assertUnprocessable();
        $this->withToken($token)->postJson("/api/payment-attempts/{$attempt->id}/repost", ['reason' => 'محاولة والفترة مقفلة'])
            ->assertOk()->assertJsonPath('data.outcome', 'blocked_period');
        app(AccountingPeriodLockService::class)->release($lock['id'], 'فتح رسمي', $this->owner);
        $this->withToken($token)->postJson("/api/payment-attempts/{$attempt->id}/repost", ['reason' => 'بعد الفتح الرسمي للفترة'])
            ->assertOk()->assertJsonPath('data.outcome', 'posted')->assertJsonPath('data.posting_status', 'posted');
        $this->withToken($token)->postJson("/api/payment-attempts/{$attempt->id}/repost", ['reason' => 'مرة ثانية بعد الترحيل'])
            ->assertStatus(409)->assertJsonPath('error.code', 'not_blocked');
        $this->assertSame(1, Payment::query()->count());
        $this->withToken($token)->getJson('/api/payment-attempts/blocked')->assertOk()->assertJsonPath('meta.count', 0);
    }

    #[Test]
    public function another_tenant_cannot_see_or_repost_this_tenants_blocked_payment(): void
    {
        [$attempt] = $this->blockedAttempt();
        $other = $this->registerTenant('pay-h2-02d-b', 'owner@pay-h2-02d-b.test');

        $this->withToken($other['token'])->getJson('/api/payment-attempts/blocked')->assertOk()->assertJsonPath('meta.count', 0);
        $this->withToken($other['token'])->postJson("/api/payment-attempts/{$attempt->id}/repost", ['reason' => 'محاولة من مستأجر آخر'])->assertNotFound();
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(PaymentAttempt::POSTING_BLOCKED_PERIOD, $attempt->fresh()->posting_status);
        $this->assertSame(0, PaymentAttemptPostingEvent::query()->count());
    }

    #[Test]
    public function fiscal_close_readiness_warns_about_blocked_payments_without_blocking_the_close(): void
    {
        $year = FiscalYearService::class;
        $created = app($year)->create(['name' => '2026', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31'], null);
        $before = app(FiscalCloseService::class)->readiness(\App\Models\FiscalYear::query()->findOrFail($created['id']));
        $this->assertNotContains('blocked_payments', array_column($before['warnings'], 'code'));

        $this->blockedAttempt();
        $after = app(FiscalCloseService::class)->readiness(\App\Models\FiscalYear::query()->findOrFail($created['id']));

        $warning = collect($after['warnings'])->firstWhere('code', 'blocked_payments');
        $this->assertNotNull($warning);
        $this->assertSame(1, $warning['details']['count']);
        $this->assertSame(115000, $warning['details']['amount_minor']);
        $this->assertSame($before['can_close'], $after['can_close'], 'تنبيه لا مانع');
    }

    #[Test]
    public function the_blocked_list_paginates_and_reports_the_full_total(): void
    {
        $requests = [];
        foreach (range(1, 3) as $i) {   // الفواتير تُرحَّل قبل القفل (القفل يمنع ترحيلها بتاريخ اليوم)
            $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
                ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
                [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
            ));
            $requests[] = $this->requests->create($invoice, $this->gateway, $this->owner);
        }
        app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        [$first, $second, $third] = array_map(function (InvoicePaymentRequest $request): PaymentAttempt {
            $attempt = $this->requests->startAttempt($request, 'idem-pg-'.uniqid(), null, $this->owner);
            $this->fake->script($attempt->provider_payment_id, 'captured');
            $this->orchestrator->sync($attempt);

            return $attempt->fresh();
        }, $requests);
        $token = $this->owner->createToken('t')->plainTextToken;

        $page1 = $this->withToken($token)->getJson('/api/payment-attempts/blocked?per_page=2')->assertOk()
            ->assertJsonPath('meta.total', 3)->assertJsonPath('meta.count', 3)->assertJsonPath('meta.last_page', 2)->assertJsonCount(2, 'data');
        $page2 = $this->withToken($token)->getJson('/api/payment-attempts/blocked?per_page=2&page=2')->assertOk()->assertJsonCount(1, 'data');
        $ids = array_merge(array_column($page1->json('data'), 'id'), array_column($page2->json('data'), 'id'));
        $this->assertEqualsCanonicalizing([$first->id, $second->id, $third->id], $ids, 'كل المحجوب يمكن الوصول إليه');
        $this->withToken($token)->getJson('/api/payment-attempts/blocked?per_page=1000')->assertOk()->assertJsonPath('meta.per_page', 100);
    }

    #[Test]
    public function deleting_a_tenant_with_posting_events_cascades_cleanly_but_direct_deletes_stay_refused(): void
    {
        [$attempt] = $this->blockedAttempt();
        $this->posting->repost($attempt, $this->owner, 'سجل قرار للاختبار');
        $eventId = PaymentAttemptPostingEvent::query()->sole()->id;

        $this->thrown(fn () => DB::transaction(fn () => DB::table('payment_attempt_posting_events')->where('id', $eventId)->delete()), 'direct delete', QueryException::class);

        // الحذف المتسلسل للمستأجر يزيل أحداثه معه (لا يعلق بالمُشغّل)، على SQLite وPostgreSQL.
        DB::table('tenants')->where('id', $this->tenant->id)->delete();
        $this->assertSame(0, DB::table('payment_attempt_posting_events')->where('id', $eventId)->count());
        $this->assertSame(0, DB::table('tenants')->where('id', $this->tenant->id)->count());
    }

    /** @return array{0: PaymentAttempt, 1: Invoice, 2: array<string, mixed>} محاولة ملتقطة محجوبة بقفل فترة أكتوبر. */
    private function blockedAttempt(): array
    {
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $lock = app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        $attempt = $this->requests->startAttempt($request, 'idem-rp-'.uniqid(), null, $this->owner);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $this->orchestrator->sync($attempt);
        $attempt = $attempt->fresh();
        $this->assertSame(PaymentAttempt::POSTING_BLOCKED_PERIOD, $attempt->posting_status);
        $this->assertInstanceOf(InvoicePaymentRequest::class, $request);

        return [$attempt, $invoice, $lock];
    }
}
