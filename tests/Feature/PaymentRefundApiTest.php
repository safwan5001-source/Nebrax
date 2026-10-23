<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\InvoicePaymentRequest;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentRefund;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\SchedulerHeartbeat;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H3-01d — واجهة REST لاستردادات البوابة: الصلاحيات المستقلة، الاعتماد بفاعل مختلف، رموز الرفض الثابتة، العزل بين المستأجرين، وتكامل الترحيل A5.
 */
class PaymentRefundApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $admin;

    private string $ownerToken;

    private string $adminToken;

    private Partner $customer;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private PlatformAdministrator $platform;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->tenant = Tenant::create(['name' => 'شركة الواجهة', 'slug' => 'pay-h3-01d', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('sales', ['allow_standalone_credit_notes' => true], $this->tenant);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h3-01d.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المدير', 'email' => 'admin@pay-h3-01d.test', 'password' => 'password123', 'role' => 'admin']);
        $this->ownerToken = $this->owner->createToken('t')->plainTextToken;
        $this->adminToken = $this->admin->createToken('t')->plainTextToken;
        $this->customer = Partner::create(['name' => 'عميل الواجهة', 'type' => 'customer']);
        $this->platform = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h3-01d.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($this->platform, $this->tenant->id, true, 'تفعيل للاختبار');
    }

    #[Test]
    public function the_full_api_flow_requests_approves_submits_and_posts_the_a5_entry(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();

        $context = $this->withToken($this->ownerToken)->getJson("/api/payment-attempts/{$attempt->id}/refund-context")->assertOk()
            ->assertJsonPath('data.eligible', true)->assertJsonPath('data.refundable_minor', 115000)->assertJsonPath('data.captured_minor', 115000)
            ->assertJsonPath('data.sources.0.id', $note->id)->assertJsonPath('data.sources.0.refundable', 115000);
        $this->assertNull($context->json('data.blocker'));

        $created = $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', $this->payload($attempt, $note, 115000, 'idem-api-0001'))
            ->assertCreated()->assertJsonPath('data.status', 'requested')->assertJsonPath('data.requested_by.name', 'المالك')
            ->assertJsonPath('data.partner_name', 'عميل الواجهة');
        $id = $created->json('data.id');

        // تكرار المفتاح نفسه يعيد المستند نفسه.
        $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', $this->payload($attempt, $note, 115000, 'idem-api-0001'))
            ->assertCreated()->assertJsonPath('data.id', $id);
        $this->assertSame(1, PaymentRefund::query()->count());

        // اعتماد ذاتي مرفوض برمز ثابت.
        $this->withToken($this->ownerToken)->postJson("/api/payment-refunds/{$id}/approve")->assertStatus(409)->assertJsonPath('error.code', 'self_approval');

        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$id}/approve", ['submit' => true])->assertOk()
            ->assertJsonPath('data.status', 'confirmed')->assertJsonPath('data.approved_by.name', 'المدير')
            ->assertJsonPath('data.posting_status', 'posted')->assertJsonPath('data.accounting_date', '2026-10-23')
            ->assertJsonPath('meta.submit_error', null);
        $entry = JournalEntry::query()->with('lines.account')->findOrFail(PaymentRefund::query()->findOrFail($id)->journal_entry_id);
        $this->assertEqualsCanonicalizing(['1130', '1170'], $entry->lines->map(fn ($l) => $l->account->code)->all());

        $this->withToken($this->adminToken)->getJson("/api/payment-refunds/{$id}")->assertOk()
            ->assertJsonPath('data.allocations.0.source_number', $note->number)->assertJsonPath('data.allocations.0.amount_minor', 115000)
            ->assertJsonPath('data.invocations.0.baseline_refunded_minor', 0)
            ->assertJsonCount(4, 'data.timeline');
        $this->withToken($this->adminToken)->getJson('/api/payment-refunds?status=confirmed&posting_status=posted')->assertOk()->assertJsonPath('meta.total', 1);
        $this->withToken($this->adminToken)->getJson('/api/payment-refunds?status=requested')->assertOk()->assertJsonPath('meta.total', 0);
    }

    #[Test]
    public function only_the_four_permissions_open_the_endpoints_and_anonymous_users_are_refused(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $accountant = User::create(['tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'acc@pay-h3-01d.test', 'password' => 'password123', 'role' => 'accountant'])->createToken('t')->plainTextToken;
        $staff = User::create(['tenant_id' => $this->tenant->id, 'name' => 'موظف', 'email' => 'staff@pay-h3-01d.test', 'password' => 'password123', 'role' => 'staff'])->createToken('t')->plainTextToken;
        $refund = $this->requestRefund($attempt, $note, 1000, 'idem-rbac-0001');
        $uuid = (string) \Illuminate\Support\Str::uuid();

        foreach ([$accountant, $staff] as $token) {
            $this->withToken($token)->getJson('/api/payment-refunds')->assertForbidden();
            $this->withToken($token)->getJson("/api/payment-refunds/{$refund->id}")->assertForbidden();
            $this->withToken($token)->getJson("/api/payment-attempts/{$attempt->id}/refund-context")->assertForbidden();
            $this->withToken($token)->postJson('/api/payment-refunds', $this->payload($attempt, $note, 1000, 'idem-rbac-0002'))->assertForbidden();
            $this->withToken($token)->postJson("/api/payment-refunds/{$refund->id}/approve")->assertForbidden();
            $this->withToken($token)->postJson("/api/payment-refunds/{$refund->id}/submit")->assertForbidden();
            $this->withToken($token)->postJson("/api/payment-refunds/{$refund->id}/reject", ['reason' => 'سبب كافٍ'])->assertForbidden();
            $this->withToken($token)->postJson("/api/payment-refunds/{$refund->id}/cancel", ['reason' => 'سبب كافٍ'])->assertForbidden();
            $this->withToken($token)->postJson("/api/payment-refunds/{$refund->id}/resolve", ['decision' => 'confirm', 'reason' => 'سبب كافٍ'])->assertForbidden();
            $this->withToken($token)->postJson("/api/payment-refunds/{$refund->id}/repost", ['reason' => 'سبب كافٍ'])->assertForbidden();
            $this->withToken($token)->postJson("/api/payment-attempts/{$attempt->id}/resolve-external-refund", ['reason' => 'سبب كافٍ'])->assertForbidden();
        }
        $this->flushHeaders();
        $this->getJson('/api/payment-refunds')->assertUnauthorized();
        $this->getJson("/api/payment-refunds/{$uuid}")->assertUnauthorized();
        $this->assertSame(PaymentRefund::REQUESTED, $refund->fresh()->status);
    }

    #[Test]
    public function validation_and_domain_rejections_use_stable_codes(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();

        $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', [])->assertUnprocessable();
        $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', ['payment_attempt_id' => $attempt->id, 'amount_minor' => 0, 'idempotency_key' => 'idem-val-0001', 'allocations' => []])->assertUnprocessable();
        $bad = $this->payload($attempt, $note, 1000, 'idem-val-0002');
        $bad['allocations'][0]['source_type'] = 'invoice';
        $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', $bad)->assertUnprocessable();

        $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', $this->payload($attempt, $note, 115001, 'idem-val-0003'))
            ->assertUnprocessable()->assertJsonPath('error.code', 'exceeds_source_balance');
        $short = $this->payload($attempt, $note, 5000, 'idem-val-0004');
        $short['allocations'][0]['amount_minor'] = 4000;
        $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', $short)->assertUnprocessable()->assertJsonPath('error.code', 'invalid_allocations');
        $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', $this->payload($attempt, $note, 1000, 'idem-val-0005') + [])->assertCreated();
        $other = $this->payload($attempt, $note, 2000, 'idem-val-0005');
        $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', $other)->assertStatus(409)->assertJsonPath('error.code', 'idempotency_conflict');
        $this->assertSame(1, PaymentRefund::query()->count());
    }

    #[Test]
    public function the_context_explains_why_a_payment_is_not_refundable(): void
    {
        $attempt = $this->postedCapture();
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['posting_status' => 'blocked_period']);

        $this->withToken($this->ownerToken)->getJson("/api/payment-attempts/{$attempt->id}/refund-context")->assertOk()
            ->assertJsonPath('data.eligible', false)->assertJsonPath('data.blocker.code', 'capture_not_posted')->assertJsonPath('data.sources', []);
    }

    #[Test]
    public function reject_cancel_and_resolve_flows_work_through_the_api(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $a = $this->requestRefund($attempt, $note, 10000, 'idem-flow-0001');
        $b = $this->requestRefund($attempt, $note, 10000, 'idem-flow-0002');

        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$a->id}/reject", ['reason' => 'abc'])->assertUnprocessable();
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$a->id}/reject", ['reason' => 'مبلغ غير مبرَّر'])->assertOk()
            ->assertJsonPath('data.status', 'rejected')->assertJsonPath('data.reject_reason', 'مبلغ غير مبرَّر');
        $this->withToken($this->ownerToken)->postJson("/api/payment-refunds/{$b->id}/cancel", ['reason' => 'طلبته بالخطأ'])->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$b->id}/approve")->assertStatus(409)->assertJsonPath('error.code', 'invalid_state');

        // unknown ثم حسم بشري عبر الواجهة.
        $c = $this->requestRefund($attempt, $note, 40000, 'idem-flow-0003');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$c->id}/approve")->assertOk();
        $this->fake->failNextRefund('unknown_applied');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$c->id}/submit")->assertOk()->assertJsonPath('data.status', 'unknown');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$c->id}/resolve", ['decision' => 'confirm', 'reason' => 'هذا استردادنا فعلاً'])
            ->assertOk()->assertJsonPath('data.status', 'confirmed')->assertJsonPath('data.posting_status', 'posted');
        $this->assertSame(40000, $attempt->fresh()->refunded_minor);
    }

    #[Test]
    public function an_external_refund_flag_is_surfaced_and_resolved_through_the_api(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->requestRefund($attempt, $note, 40000, 'idem-ext-00001');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$refund->id}/approve")->assertOk();
        $this->fake->scriptRefunded($attempt->provider_payment_id, 20000);

        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$refund->id}/submit")->assertStatus(409)->assertJsonPath('error.code', 'unrecognized_refund_open');
        $this->withToken($this->adminToken)->getJson("/api/payment-attempts/{$attempt->id}")->assertOk()
            ->assertJsonPath('data.unrecognized_refund', true)->assertJsonPath('data.unrecognized_refund_minor', 20000);
        $this->withToken($this->adminToken)->getJson("/api/payment-attempts/{$attempt->id}/refund-context")->assertOk()
            ->assertJsonPath('data.eligible', false)->assertJsonPath('data.blocker.code', 'unrecognized_refund_open');

        $this->withToken($this->adminToken)->postJson("/api/payment-attempts/{$attempt->id}/resolve-external-refund", ['reason' => 'راجعنا الاسترداد الخارجي'])
            ->assertOk()->assertJsonPath('data.refunded_minor', 20000);
        $this->withToken($this->adminToken)->getJson("/api/payment-refunds/{$refund->id}")->assertOk()->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.cancel_reason', 'external_refund_resolved');
        $this->withToken($this->adminToken)->postJson("/api/payment-attempts/{$attempt->id}/resolve-external-refund", ['reason' => 'مرة ثانية بلا علم'])->assertStatus(409)->assertJsonPath('error.code', 'no_unrecognized_refund');
    }

    #[Test]
    public function a_locked_period_blocks_posting_and_the_repost_endpoint_posts_after_the_formal_reopen(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $lock = app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        $refund = $this->requestRefund($attempt, $note, 115000, 'idem-lock-0001');

        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$refund->id}/approve", ['submit' => true])->assertOk()
            ->assertJsonPath('data.status', 'confirmed')->assertJsonPath('data.posting_status', 'blocked_period')->assertJsonPath('data.blocked_reason.kind', 'period');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$refund->id}/repost", ['reason' => 'محاولة قبل الفتح'])->assertOk()->assertJsonPath('data.outcome', 'blocked_period');

        app(AccountingPeriodLockService::class)->release($lock['id'], 'فتح رسمي', $this->owner);
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$refund->id}/repost", ['reason' => 'بعد الفتح الرسمي للفترة'])->assertOk()
            ->assertJsonPath('data.outcome', 'posted')->assertJsonPath('data.posting_status', 'posted')->assertJsonPath('data.accounting_date', '2026-10-23');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$refund->id}/repost", ['reason' => 'مرة ثانية بعد الترحيل'])->assertStatus(409)->assertJsonPath('error.code', 'not_blocked');
    }

    #[Test]
    public function domain_failures_in_repost_return_422_with_a_stable_code_not_500(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $lock = app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        $refund = $this->requestRefund($attempt, $note, 115000, 'idem-422-0001');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$refund->id}/approve", ['submit' => true])->assertOk()
            ->assertJsonPath('data.posting_status', 'blocked_period');
        app(AccountingPeriodLockService::class)->release($lock['id'], 'فتح رسمي', $this->owner);
        DB::table('account_role_mappings')->where('role_key', 'gateway_clearing')->delete();

        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$refund->id}/repost", ['reason' => 'بعد الفتح الرسمي للفترة'])
            ->assertStatus(422)->assertJsonPath('error.code', 'operation_rejected');
        $this->assertSame('blocked_period', $refund->fresh()->posting_status);
    }

    #[Test]
    public function the_requester_cannot_reject_their_own_request_and_unknown_sources_are_refused(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->requestRefund($attempt, $note, 5000, 'idem-self-0001');

        $this->withToken($this->ownerToken)->postJson("/api/payment-refunds/{$refund->id}/reject", ['reason' => 'أرفض طلبي بنفسي'])
            ->assertStatus(409)->assertJsonPath('error.code', 'self_approval');
        $this->assertSame(PaymentRefund::REQUESTED, $refund->fresh()->status);

        $payload = $this->payload($attempt, $note, 5000, 'idem-self-0002');
        $payload['allocations'][0]['source_id'] = '00000000-0000-4000-8000-000000000000';
        $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', $payload)->assertStatus(422);
        $this->assertSame(1, PaymentRefund::query()->count());
    }

    #[Test]
    public function the_list_scopes_filter_pending_and_attention_on_the_server(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $requested = $this->requestRefund($attempt, $note, 10000, 'idem-scope-0001');
        $unknown = $this->requestRefund($attempt, $note, 20000, 'idem-scope-0002');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$unknown->id}/approve")->assertOk();
        $this->fake->failNextRefund('unknown_applied');
        $this->withToken($this->adminToken)->postJson("/api/payment-refunds/{$unknown->id}/submit")->assertOk()->assertJsonPath('data.status', 'unknown');

        $pending = $this->withToken($this->adminToken)->getJson('/api/payment-refunds?scope=pending')->assertOk();
        $this->assertSame([$requested->id], collect($pending->json('data'))->pluck('id')->all());
        $attention = $this->withToken($this->adminToken)->getJson('/api/payment-refunds?scope=attention')->assertOk();
        $this->assertSame([$unknown->id], collect($attention->json('data'))->pluck('id')->all());
        $this->withToken($this->adminToken)->getJson('/api/payment-refunds?scope=bogus')->assertUnprocessable();
        $this->withToken($this->adminToken)->getJson('/api/payment-refunds')->assertOk()->assertJsonPath('meta.total', 2);
    }

    #[Test]
    public function another_tenant_cannot_see_or_act_on_these_refunds(): void
    {
        $attempt = $this->postedCapture();
        $note = $this->creditNote();
        $refund = $this->requestRefund($attempt, $note, 1000, 'idem-iso-00001');
        $other = $this->registerTenant('pay-h3-01d-b', 'owner@pay-h3-01d-b.test');
        $token = $other['token'];

        $this->withToken($token)->getJson('/api/payment-refunds')->assertOk()->assertJsonPath('meta.total', 0);
        $this->withToken($token)->getJson("/api/payment-refunds/{$refund->id}")->assertNotFound();
        $this->withToken($token)->getJson("/api/payment-attempts/{$attempt->id}/refund-context")->assertNotFound();
        $this->withToken($token)->postJson("/api/payment-refunds/{$refund->id}/approve")->assertNotFound();
        $this->withToken($token)->postJson("/api/payment-refunds/{$refund->id}/cancel", ['reason' => 'محاولة من مستأجر آخر'])->assertNotFound();
        $this->withToken($token)->postJson('/api/payment-refunds', $this->payload($attempt, $note, 1000, 'idem-iso-00002'))->assertNotFound();
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(PaymentRefund::REQUESTED, $refund->fresh()->status);
        $this->assertSame(1, PaymentRefund::query()->count());
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @return array<string, mixed> */
    private function payload(PaymentAttempt $attempt, CreditNote $note, int $amount, string $key): array
    {
        return [
            'payment_attempt_id' => $attempt->id, 'amount_minor' => $amount, 'idempotency_key' => $key,
            'allocations' => [['source_type' => 'credit_note', 'source_id' => $note->id, 'amount_minor' => $amount]],
        ];
    }

    private function requestRefund(PaymentAttempt $attempt, CreditNote $note, int $amount, string $key): PaymentRefund
    {
        $id = $this->withToken($this->ownerToken)->postJson('/api/payment-refunds', $this->payload($attempt, $note, $amount, $key))->assertCreated()->json('data.id');

        return PaymentRefund::query()->findOrFail($id);
    }

    private function creditNote(): CreditNote
    {
        app(TenantContext::class)->set($this->tenant->id);
        $service = app(CreditNoteService::class);
        $note = $service->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'refund_type' => 'credit', 'reason' => 'تصحيح تجاري'],
            [['description' => 'تصحيح', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        return $service->post($note);
    }

    private function postedCapture(): PaymentAttempt
    {
        app(TenantContext::class)->set($this->tenant->id);
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $requests = app(InvoicePaymentRequestService::class);
        $request = $requests->create($invoice, $this->gateway, $this->owner);
        $this->assertInstanceOf(InvoicePaymentRequest::class, $request);
        $attempt = $requests->startAttempt($request, 'idem-cap-'.uniqid(), null, $this->owner);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        app(PaymentOrchestrator::class)->sync($attempt);
        $attempt = $attempt->fresh();
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->posting_status);

        return $attempt;
    }
}
