<?php

namespace Tests\Feature;

use App\Models\InvoicePaymentRequest;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentAttemptPostingService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H2-03c — سجل الدفعات الإلكترونية (قراءة فقط): القائمة المرشَّحة والتفصيل مع الخط الزمني، الصلاحية `payments.view`،
 * عزل المستأجر، وعدم تسريب الرمز العام أو `body` أحداث المزوّد. لا أثر محاسبي.
 */
class PaymentAttemptLogTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Partner $customer;

    private PaymentGateway $gateway;

    private FakePaymentGatewayAdapter $fake;

    private InvoicePaymentRequestService $requests;

    private PaymentOrchestrator $orchestrator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->tenant = Tenant::create(['name' => 'شركة السجل', 'slug' => 'pay-h2-03c', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h2-03c.test', 'password' => 'password123', 'role' => 'owner']);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h2-03c.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($admin, $this->tenant->id, true, 'تفعيل للاختبار');
        $this->requests = app(InvoicePaymentRequestService::class);
        $this->orchestrator = app(PaymentOrchestrator::class);
    }

    #[Test]
    public function the_list_filters_by_status_and_returns_safe_fields_only(): void
    {
        [$captured, $request] = $this->capturedAttempt();
        $pending = $this->attemptFor($this->requestFor());
        $token = $this->owner->createToken('t')->plainTextToken;

        $all = $this->withToken($token)->getJson('/api/payment-attempts')->assertOk()->assertJsonPath('meta.total', 2);
        $this->assertEqualsCanonicalizing([$captured->id, $pending->id], array_column($all->json('data'), 'id'));

        $row = collect($all->json('data'))->firstWhere('id', $captured->id);
        $this->assertSame('captured', $row['capture_status']);
        $this->assertSame('posted', $row['posting_status']);
        $this->assertSame(115000, $row['captured_minor']);
        $this->assertSame($request->id, $row['request_id']);
        $this->assertSame('Fake', $row['gateway']['name']);
        $this->assertNotNull($row['invoice']['number']);
        foreach (['token_hash', 'checkout_url', 'provider_payment_id', 'idempotency_key', 'body'] as $secret) {
            $this->assertArrayNotHasKey($secret, $row);
        }

        $this->withToken($token)->getJson('/api/payment-attempts?capture_status=captured')->assertOk()
            ->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $captured->id);
        $this->withToken($token)->getJson('/api/payment-attempts?capture_status=pending_customer')->assertOk()
            ->assertJsonPath('data.0.id', $pending->id);
        $this->withToken($token)->getJson('/api/payment-attempts?posting_status=posted')->assertOk()->assertJsonPath('meta.total', 1);
        $this->withToken($token)->getJson('/api/payment-attempts?capture_status=bogus')->assertUnprocessable();
        $this->withToken($token)->getJson('/api/payment-attempts?per_page=1&page=2')->assertOk()
            ->assertJsonPath('meta.total', 2)->assertJsonPath('meta.last_page', 2)->assertJsonCount(1, 'data');
        $this->withToken($token)->getJson('/api/payment-attempts?per_page=1000')->assertUnprocessable();
    }

    #[Test]
    public function the_needs_review_and_invoice_filters_narrow_the_list(): void
    {
        [$ok] = $this->capturedAttempt();
        $flagged = $this->attemptFor($this->requestFor());
        DB::table('payment_attempts')->where('id', $flagged->id)->update(['review_reasons' => json_encode(['late_capture'])]);
        $token = $this->owner->createToken('t')->plainTextToken;

        $this->withToken($token)->getJson('/api/payment-attempts?needs_review=1')->assertOk()
            ->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $flagged->id)->assertJsonPath('data.0.review_reasons.0', 'late_capture');

        $invoiceId = $this->withToken($token)->getJson('/api/payment-attempts?capture_status=captured')->json('data.0.invoice.id');
        $this->withToken($token)->getJson("/api/payment-attempts?invoice_id={$invoiceId}")->assertOk()
            ->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $ok->id);
        $this->withToken($token)->getJson('/api/payment-attempts?invoice_id='.\Illuminate\Support\Str::uuid())->assertOk()->assertJsonPath('meta.total', 0);
    }

    #[Test]
    public function the_detail_shows_postings_and_a_ordered_timeline_with_the_repost_decision(): void
    {
        $lock = null;
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $lock = app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        $attempt = $this->attemptFor($request);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $this->orchestrator->sync($attempt);
        $attempt = $attempt->fresh();
        $this->assertSame(PaymentAttempt::POSTING_BLOCKED_PERIOD, $attempt->posting_status);
        $this->travel(5)->minutes();
        app(PaymentAttemptPostingService::class)->repost($attempt, $this->owner, 'محاولة والفترة مقفلة');
        app(AccountingPeriodLockService::class)->release($lock['id'], 'فتح رسمي', $this->owner);
        $this->travel(5)->minutes();
        app(PaymentAttemptPostingService::class)->repost($attempt->fresh(), $this->owner, 'بعد الفتح الرسمي للفترة');
        $token = $this->owner->createToken('t')->plainTextToken;

        $res = $this->withToken($token)->getJson("/api/payment-attempts/{$attempt->id}")->assertOk()
            ->assertJsonPath('data.posting_status', 'posted')->assertJsonPath('data.postings.0.role', 'allocated')
            ->assertJsonPath('data.postings.0.amount_minor', 115000);
        $this->assertNotNull($res->json('data.postings.0.payment_number'));

        $types = array_column($res->json('data.timeline'), 'type');
        $this->assertSame('created', $types[0]);
        $this->assertContains('captured', $types);
        $this->assertSame(['repost', 'repost'], array_values(array_filter($types, fn ($t) => $t === 'repost')));
        $reposts = array_values(array_filter($res->json('data.timeline'), fn ($e) => $e['type'] === 'repost'));
        $this->assertSame('still_blocked', $reposts[0]['outcome']);
        $this->assertSame('posted', $reposts[1]['outcome']);
        $this->assertSame('المالك', $reposts[1]['actor']);
        $this->assertSame('بعد الفتح الرسمي للفترة', $reposts[1]['reason']);
        $ats = array_column($res->json('data.timeline'), 'at');
        $sorted = $ats;
        sort($sorted);
        $this->assertSame($sorted, $ats, 'الخط الزمني مرتب');
        $this->assertStringNotContainsString('"body"', json_encode($res->json()));
    }

    #[Test]
    public function the_log_requires_payments_view_and_is_tenant_isolated(): void
    {
        [$attempt] = $this->capturedAttempt();
        $selfToken = User::create(['tenant_id' => $this->tenant->id, 'name' => 'ذاتي', 'email' => 'self@pay-h2-03c.test', 'password' => 'password123', 'role' => 'self_service'])->createToken('t')->plainTextToken;
        $acc = User::create(['tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'acc@pay-h2-03c.test', 'password' => 'password123', 'role' => 'accountant'])->createToken('t')->plainTextToken;
        $this->getJson('/api/payment-attempts')->assertUnauthorized();
        $this->withToken($acc)->getJson('/api/payment-attempts')->assertOk()->assertJsonPath('meta.total', 1);
        $this->withToken($selfToken)->getJson('/api/payment-attempts')->assertStatus(403);
        $this->withToken($selfToken)->getJson("/api/payment-attempts/{$attempt->id}")->assertStatus(403);

        $other = $this->registerTenant('pay-h2-03c-b', 'owner@pay-h2-03c-b.test');
        $this->withToken($other['token'])->getJson('/api/payment-attempts')->assertOk()->assertJsonPath('meta.total', 0);
        $this->withToken($other['token'])->getJson("/api/payment-attempts/{$attempt->id}")->assertNotFound();
    }

    #[Test]
    public function a_soft_deleted_actor_stays_named_in_the_audit_timeline(): void
    {
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $this->owner);
        $attempt = $this->attemptFor($request);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $this->orchestrator->sync($attempt);
        $admin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'مدير سابق', 'email' => 'former@pay-h2-03c.test', 'password' => 'password123', 'role' => 'admin']);
        app(PaymentAttemptPostingService::class)->repost($attempt->fresh(), $admin, 'قرار قبل مغادرة الموظف');
        $admin->delete();
        $this->assertNotNull(User::withTrashed()->find($admin->id)->deleted_at);

        $token = $this->owner->createToken('t')->plainTextToken;
        $timeline = $this->withToken($token)->getJson("/api/payment-attempts/{$attempt->id}")->assertOk()->json('data.timeline');
        $repost = collect($timeline)->firstWhere('type', 'repost');
        $this->assertSame('مدير سابق', $repost['actor']);
    }

    private function requestFor(): InvoicePaymentRequest
    {
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));

        return $this->requests->create($invoice, $this->gateway, $this->owner);
    }

    private function attemptFor(InvoicePaymentRequest $request): PaymentAttempt
    {
        return $this->requests->startAttempt($request, 'idem-log-'.uniqid(), null, $this->owner)->fresh();
    }

    /** @return array{0: PaymentAttempt, 1: InvoicePaymentRequest} */
    private function capturedAttempt(): array
    {
        $request = $this->requestFor();
        $attempt = $this->attemptFor($request);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $this->orchestrator->sync($attempt);

        return [$attempt->fresh(), $request];
    }
}
