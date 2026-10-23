<?php

namespace Tests\Feature;

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
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentsRolloutControlService;
use App\Support\PaymentOrchestrationException;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H2-02b — طلبات دفع الفواتير: الإنشاء/الإلغاء، الدفع الجزئي لكل رابط (D-16)، التقاط فوري فقط (D-24)، العزل وRBAC، ولا أثر محاسبي.
 * فاتورة الاختبار 1,150.00 ر.س (115000 هللة).
 */
class InvoicePaymentRequestTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Partner $customer;

    private PaymentGateway $gateway;

    private PlatformAdministrator $admin;

    private FakePaymentGatewayAdapter $fake;

    private InvoicePaymentRequestService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'شركة طلبات الدفع', 'slug' => 'pay-h2-02b', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h2-02b.test', 'password' => 'password123', 'role' => 'owner']);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h2-02b.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $this->gateway = $this->gateway();
        $this->service = app(InvoicePaymentRequestService::class);
        $this->enableRollout();
    }

    // ═══════════════ الإنشاء ═══════════════

    #[Test]
    public function creating_a_request_defaults_to_no_partial_payment_and_creates_no_financial_artifact(): void
    {
        $invoice = $this->invoice();
        $request = $this->service->create($invoice, $this->gateway, $this->owner);

        $this->assertSame('open', $request->status);
        $this->assertFalse($request->allow_partial);
        $this->assertSame($invoice->partner_id, $request->partner_id);
        $this->assertSame('SAR', $request->currency);
        $this->assertSame($this->owner->id, $request->created_by);
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function creation_is_refused_for_unpayable_invoices_unusable_gateways_and_a_disabled_rollout(): void
    {
        $invoice = $this->invoice();
        $draft = app(InvoiceService::class)->create(['partner_id' => $this->customer->id, 'payment_type' => 'credit'], [['quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 15]]);

        $this->assertReason('invoice_not_payable', fn () => $this->service->create($draft, $this->gateway, $this->owner));

        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_SUSPENDED, 'is_active' => false]);
        $this->assertReason('gateway_unavailable', fn () => $this->service->create($invoice, $this->gateway, $this->owner));
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);

        $real = PaymentGateway::query()->create(['provider' => 'stripe', 'name' => 'Stripe', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $real->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->assertReason('gateway_unverified', fn () => $this->service->create($invoice, $real->fresh(), $this->owner));

        $this->assertReason('invalid_expiry', fn () => $this->service->create($invoice, $this->gateway, $this->owner, false, now()->subMinute()));

        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $this->tenant->id, false, 'إيقاف للاختبار');
        $this->assertReason('rollout_disabled', fn () => $this->service->create($invoice, $this->gateway, $this->owner));

        $this->assertSame(0, InvoicePaymentRequest::query()->count());
    }

    #[Test]
    public function a_paid_invoice_and_a_second_open_request_are_both_refused(): void
    {
        $invoice = $this->invoice();
        $this->service->create($invoice, $this->gateway, $this->owner);

        $this->assertReason('open_request_exists', fn () => $this->service->create($invoice, $this->gateway, $this->owner));

        DB::table('invoices')->where('id', $invoice->id)->update(['paid_amount' => 115000, 'payment_status' => 'paid']);
        $this->assertReason('invoice_not_payable', fn () => $this->service->create($invoice->fresh(), $this->gateway, $this->owner));
    }

    // ═══════════════ بدء المحاولة والدفع الجزئي (D-16) ═══════════════

    #[Test]
    public function a_full_attempt_uses_the_remaining_amount_and_is_idempotent(): void
    {
        $request = $this->service->create($this->invoice(), $this->gateway, $this->owner);

        $attempt = $this->service->startAttempt($request, 'idem-req-0001', null, $this->owner);
        $again = $this->service->startAttempt($request, 'idem-req-0001', null, $this->owner);

        $this->assertSame(115000, $attempt->amount_minor);
        $this->assertSame('invoice_payment_request:'.$request->id, $attempt->payable_key);
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, $attempt->capture_status);
        $this->assertNotNull($attempt->checkout_url);
        $this->assertSame($attempt->id, $again->id);
        $this->assertCount(1, $this->fake->checkoutCalls);
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function a_partial_amount_is_refused_unless_the_link_enabled_it_and_never_exceeds_the_remaining(): void
    {
        $strict = $this->service->create($this->invoice(), $this->gateway, $this->owner);
        $this->assertReason('partial_not_allowed', fn () => $this->service->startAttempt($strict, 'idem-req-0002', 50000, $this->owner));
        $full = $this->service->startAttempt($strict, 'idem-req-0003', 115000, $this->owner);   // المبلغ = المتبقي مسموح دائماً
        $this->assertSame(115000, $full->amount_minor);
        $this->service->cancel($strict, $this->owner);

        $flexible = $this->service->create($strict->invoice()->first(), $this->gateway, $this->owner, true);
        $this->assertTrue($flexible->allow_partial);
        $this->assertReason('amount_exceeds_remaining', fn () => $this->service->startAttempt($flexible, 'idem-req-0004', 115001, $this->owner));
        foreach ([0, -5] as $bad) {
            $this->assertReason('invalid_amount', fn () => $this->service->startAttempt($flexible, 'idem-req-0005', $bad, $this->owner));
        }

        $partial = $this->service->startAttempt($flexible, 'idem-req-0006', 50000, $this->owner);
        $this->assertSame(50000, $partial->amount_minor);
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function an_expired_or_closed_request_cannot_start_an_attempt(): void
    {
        $request = $this->service->create($this->invoice(), $this->gateway, $this->owner, false, now()->addMinutes(10));
        DB::table('invoice_payment_requests')->where('id', $request->id)->update(['expires_at' => now()->subMinute()]);
        $this->assertReason('request_expired', fn () => $this->service->startAttempt($request, 'idem-req-0007', null, $this->owner));

        $other = $this->service->create($this->invoice(), $this->gateway, $this->owner);
        $this->service->cancel($other, $this->owner);
        $this->assertReason('request_not_open', fn () => $this->service->startAttempt($other, 'idem-req-0008', null, $this->owner));
    }

    #[Test]
    public function when_the_invoice_is_paid_meanwhile_the_attempt_cannot_start(): void
    {
        $invoice = $this->invoice();
        $request = $this->service->create($invoice, $this->gateway, $this->owner);
        DB::table('invoices')->where('id', $invoice->id)->update(['paid_amount' => 115000, 'payment_status' => 'paid']);

        $e = $this->thrown(fn () => $this->service->startAttempt($request, 'idem-req-0009', null, $this->owner), 'paid', \Throwable::class);
        $this->assertSame(0, PaymentAttempt::query()->count());
        $this->assertNotNull($e);
    }

    // ═══════════════ الإلغاء ═══════════════

    #[Test]
    public function cancelling_cancels_the_active_attempt_and_is_idempotent(): void
    {
        $request = $this->service->create($this->invoice(), $this->gateway, $this->owner);
        $attempt = $this->service->startAttempt($request, 'idem-req-0010', null, $this->owner);

        $cancelled = $this->service->cancel($request, $this->owner);
        $this->assertSame('cancelled', $cancelled->status);
        $this->assertNotNull($cancelled->cancelled_at);
        $this->assertSame($this->owner->id, $cancelled->cancelled_by);
        $this->assertSame(PaymentAttempt::STATUS_CANCELLED, $attempt->fresh()->capture_status);

        $this->assertSame('cancelled', $this->service->cancel($request, $this->owner)->status);
    }

    #[Test]
    public function a_request_whose_payment_was_captured_at_the_provider_cannot_be_cancelled(): void
    {
        $request = $this->service->create($this->invoice(), $this->gateway, $this->owner);
        $attempt = $this->service->startAttempt($request, 'idem-req-0011', null, $this->owner);
        $this->fake->script($attempt->provider_payment_id, 'captured');

        $this->assertReason('payment_captured', fn () => $this->service->cancel($request, $this->owner));
        // مزامنة المزوّد قبل الإلغاء طبّقت الالتقاط؛ منذ PAY-H2-02c يُرحَّل فيكتمل الطلب (لا إلغاء أبداً لدفعة ملتقطة).
        $this->assertSame('completed', $request->fresh()->status);
        $this->assertSame(1, Payment::query()->count());
    }

    // ═══════════════ الصلاحيات والعزل (API) ═══════════════

    #[Test]
    public function the_api_requires_payments_manage_for_writes_and_returns_stable_error_codes(): void
    {
        $auth = $this->registerTenant('h2-02b-api', 'owner@h2-02b-api.test');
        $tenantId = $auth['tenant_id'];
        [$invoice, $gateway] = $this->apiFixture($tenantId);
        $staff = $this->tokenForRole($tenantId, 'staff', 'staff@h2-02b-api.test');
        $accountant = $this->tokenForRole($tenantId, 'accountant', 'acc@h2-02b-api.test');

        $body = ['payment_gateway_id' => $gateway->id];
        $this->withToken($staff)->postJson("/api/invoices/{$invoice->id}/payment-requests", $body)->assertForbidden();
        $this->withToken($staff)->getJson("/api/invoices/{$invoice->id}/payment-requests")->assertOk();      // payments.view

        $created = $this->withToken($accountant)->postJson("/api/invoices/{$invoice->id}/payment-requests", $body)->assertCreated()
            ->assertJsonPath('data.status', 'open')->assertJsonPath('data.allow_partial', false)->assertJsonPath('data.link_issued', false)->assertJsonMissingPath('data.token_hash');
        $id = $created->json('data.id');

        $this->withToken($accountant)->postJson("/api/invoices/{$invoice->id}/payment-requests", $body)
            ->assertStatus(409)->assertJsonPath('error.code', 'open_request_exists');
        $this->withToken($staff)->postJson("/api/payment-requests/{$id}/cancel")->assertForbidden();
        $this->withToken($staff)->postJson("/api/payment-requests/{$id}/attempts", [], ['Idempotency-Key' => 'idem-api-0001'])->assertForbidden();

        $this->withToken($accountant)->postJson("/api/payment-requests/{$id}/attempts", [])->assertUnprocessable()->assertJsonPath('error.code', 'invalid_idempotency_key');
        $this->withToken($accountant)->postJson("/api/payment-requests/{$id}/attempts", ['amount_minor' => 5000], ['Idempotency-Key' => 'idem-api-0002'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'partial_not_allowed');
        $this->withToken($accountant)->postJson("/api/payment-requests/{$id}/attempts", ['amount_minor' => 1.5], ['Idempotency-Key' => 'idem-api-0003'])->assertUnprocessable();
        $started = $this->withToken($accountant)->postJson("/api/payment-requests/{$id}/attempts", [], ['Idempotency-Key' => 'idem-api-0004'])->assertCreated()
            ->assertJsonPath('data.amount_minor', 115000)->assertJsonPath('data.capture_status', 'pending_customer');
        $this->assertNotNull($started->json('data.checkout_url'));

        $this->withToken($accountant)->postJson("/api/payment-requests/{$id}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertSame(0, Payment::query()->count());
    }

    #[Test]
    public function another_tenant_can_neither_see_nor_cancel_nor_start_nor_forge_a_request(): void
    {
        $auth = $this->registerTenant('h2-02b-iso', 'owner@h2-02b-iso.test');
        [$invoice, $gateway] = $this->apiFixture($auth['tenant_id']);
        $id = $this->withToken($auth['token'])->postJson("/api/invoices/{$invoice->id}/payment-requests", ['payment_gateway_id' => $gateway->id])->assertCreated()->json('data.id');

        $other = $this->registerTenant('h2-02b-iso2', 'owner@h2-02b-iso2.test');
        $this->withToken($other['token'])->getJson("/api/invoices/{$invoice->id}/payment-requests")->assertNotFound();
        $this->withToken($other['token'])->postJson("/api/payment-requests/{$id}/cancel")->assertNotFound();
        $this->withToken($other['token'])->postJson("/api/payment-requests/{$id}/attempts", [], ['Idempotency-Key' => 'idem-api-0005'])->assertNotFound();
        $this->withToken($other['token'])->postJson("/api/invoices/{$invoice->id}/payment-requests", ['payment_gateway_id' => $gateway->id])->assertNotFound();
        $this->assertSame('open', DB::table('invoice_payment_requests')->where('id', $id)->value('status'));
    }

    // ═══════════════ مساعدات ═══════════════

    /** @return array{0: Invoice, 1: PaymentGateway} */
    private function apiFixture(string $tenantId): array
    {
        app(TenantContext::class)->set($tenantId);
        $customer = Partner::create(['name' => 'عميل API', 'type' => 'customer']);
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
        $gateway = $this->gateway();
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $tenantId, true, 'تفعيل للاختبار');
        app(TenantContext::class)->forget();

        return [$invoice, $gateway];
    }

    private function tokenForRole(string $tenantId, string $role, string $email): string
    {
        return User::create(['tenant_id' => $tenantId, 'name' => $role, 'email' => $email, 'password' => 'password123', 'role' => $role])->createToken('t')->plainTextToken;
    }

    private function assertReason(string $reason, callable $operation): void
    {
        $e = $this->thrown($operation, $reason, PaymentOrchestrationException::class);
        $this->assertSame($reason, $e->reason);
    }

    private function gateway(): PaymentGateway
    {
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake '.uniqid(), 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);

        return $gateway->fresh();
    }

    private function invoice(): Invoice
    {
        return app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
    }

    private function enableRollout(): void
    {
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $this->tenant->id, true, 'تفعيل للاختبار');
    }

    private function assertNoFinancialArtifacts(): void
    {
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, DB::table('payment_attempt_postings')->count());
        // قيد الفاتورة نفسه وحده؛ لا قيد قبض.
        $this->assertSame(0, JournalEntry::query()->where('source_type', Payment::class)->count());
    }
}
