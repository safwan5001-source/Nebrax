<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\InvoicePaymentRequestService;
use App\Services\PaymentsRolloutControlService;
use App\Support\PaymentLinkToken;
use App\Support\PaymentOrchestrationException;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H2-02e — رابط الدفع العام `/api/pay/v1/{token}`: إصدار الرمز مرة واحدة (هاش فقط)، أقل بيانات، تحدّ للمعدّل، رؤوس no-store، عزل المستأجر،
 * بدء المحاولة (Idempotency-Key، D-16) والحالة، ومكنسة الطلبات التي لم تعد قابلة للدفع. لا أثر محاسبي في هذه الشريحة (الترحيل من 02c عند الالتقاط).
 */
class PublicPaymentLinkTest extends TestCase
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

    private PlatformAdministrator $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'شركة الرابط العام', 'slug' => 'pay-h2-02e', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h2-02e.test', 'password' => 'password123', 'role' => 'owner']);
        $this->customer = Partner::create(['name' => 'عميل سرّي الاسم', 'type' => 'customer']);
        $this->admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h2-02e.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $this->gateway = $gateway->fresh();
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $this->tenant->id, true, 'تفعيل للاختبار');
        $this->requests = app(InvoicePaymentRequestService::class);
    }

    // ═══════════════ الرمز ═══════════════

    #[Test]
    public function the_token_is_issued_once_stored_as_a_hash_only_and_never_shown_again(): void
    {
        $request = $this->openRequest();

        $token = $this->requests->issueLink($request, $this->owner);

        $this->assertTrue(PaymentLinkToken::wellFormed($token));
        $this->assertSame(43, strlen($token));
        $this->assertSame(PaymentLinkToken::hash($token), $request->fresh()->token_hash);
        $resource = (new \App\Http\Resources\InvoicePaymentRequestResource($request->fresh()))->toArray(request());
        $this->assertTrue($resource['link_issued']);
        $this->assertArrayNotHasKey('token_hash', $resource);
        $this->assertStringNotContainsString($token, json_encode($resource));
        $this->assertNotSame($token, $request->fresh()->token_hash);
        $this->assertFalse(DB::table('invoice_payment_requests')->where('token_hash', $token)->exists());
        $e = $this->thrown(fn () => $this->requests->issueLink($request, $this->owner), 'second issue', PaymentOrchestrationException::class);
        $this->assertSame('link_already_issued', $e->reason);
        $this->assertNotSame($token, $this->requests->issueLink($this->freshRequest(), $this->owner));
    }

    #[Test]
    public function issuing_a_link_requires_payments_manage_and_an_open_request(): void
    {
        $request = $this->openRequest();
        $token = $this->tokenFor('staff', 'staff@pay-h2-02e.test');
        $this->withToken($token)->postJson("/api/payment-requests/{$request->id}/link")->assertForbidden();

        $accountant = $this->tokenFor('accountant', 'acc@pay-h2-02e.test');
        $response = $this->withToken($accountant)->postJson("/api/payment-requests/{$request->id}/link")->assertCreated();
        $this->assertSame('no-store, private', $response->headers->get('Cache-Control'));
        $this->assertTrue(PaymentLinkToken::wellFormed($response->json('data.token')));
        $this->assertSame('/pay/'.$response->json('data.token'), $response->json('data.path'));
        $this->withToken($accountant)->postJson("/api/payment-requests/{$request->id}/link")->assertStatus(409)->assertJsonPath('error.code', 'link_already_issued');

        $this->requests->cancel($request, $this->owner);
        $other = $this->openRequest();
        $this->requests->cancel($other, $this->owner);
        $this->withToken($accountant)->postJson("/api/payment-requests/{$other->id}/link")->assertStatus(409)->assertJsonPath('error.code', 'request_not_open');
    }

    // ═══════════════ الواجهة العامة ═══════════════

    #[Test]
    public function the_public_page_lists_only_methods_that_are_supported_ready_and_enabled_for_the_request_gateway(): void
    {
        $token = $this->link($this->invoice());
        app(\App\Services\OnlinePaymentMethodSettingsService::class)->setEnabled('mada', true, $this->owner);
        app(\App\Services\OnlinePaymentMethodSettingsService::class)->setEnabled('visa', true, $this->owner);

        $this->getJson("/api/pay/v1/{$token}")->assertOk()->assertJsonPath('data.payment_methods', ['mada', 'visa']);

        // الاتصال لم يعد جاهزاً ⇒ لا تُعرض وسيلة (المخزَّن باقٍ)
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_SUSPENDED, 'is_active' => false]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->getJson("/api/pay/v1/{$token}")->assertOk()->assertJsonPath('data.payment_methods', []);
    }

    #[Test]
    public function the_public_page_shows_minimum_data_with_hardened_headers_and_no_authentication(): void
    {
        $invoice = $this->invoice();
        $token = $this->link($invoice);

        $response = $this->getJson("/api/pay/v1/{$token}")->assertOk()
            ->assertJsonPath('data.status', 'open')->assertJsonPath('data.merchant', 'شركة الرابط العام')
            ->assertJsonPath('data.invoice_number', $invoice->number)->assertJsonPath('data.currency', 'SAR')
            ->assertJsonPath('data.amount_due_minor', 115000)->assertJsonPath('data.allow_partial', false)
            ->assertJsonPath('data.payment_methods', []);   // لا وسيلة مُظهَرة ⇒ لا شيء للعميل (الافتراضي)
        $this->assertSame('no-store, private', $response->headers->get('Cache-Control'));
        $this->assertSame('no-referrer', $response->headers->get('Referrer-Policy'));
        $this->assertStringContainsString('noindex', (string) $response->headers->get('X-Robots-Tag'));
        $body = $response->getContent();
        foreach (['عميل سرّي الاسم', $invoice->partner_id, $this->tenant->id, 'token_hash', 'payment_gateway_id', 'vat_number'] as $secret) {
            $this->assertStringNotContainsString((string) $secret, $body, "تسرّب: {$secret}");
        }
        $this->assertFalse(app(TenantContext::class)->has() && app(TenantContext::class)->id() !== $this->tenant->id);
    }

    #[Test]
    public function unknown_malformed_and_foreign_tokens_get_one_uniform_404(): void
    {
        $this->link($this->invoice());
        foreach ([PaymentLinkToken::generate(), str_repeat('a', 43), str_repeat('A', 42), 'short', str_repeat('-', 43), str_repeat('a', 44), 'bad token!'.str_repeat('x', 40)] as $bad) {
            $r = $this->getJson('/api/pay/v1/'.rawurlencode($bad));
            $this->assertSame(404, $r->getStatusCode(), $bad);
            $this->assertSame('link_not_found', $r->json('error.code'), "جسم موحّد: {$bad}");
            $this->assertSame('no-store, private', $r->headers->get('Cache-Control'), "رؤوس الحماية: {$bad}");
            $this->assertSame('no-referrer', $r->headers->get('Referrer-Policy'));
        }
        $this->postJson('/api/pay/v1/'.PaymentLinkToken::generate().'/attempts', [], ['Idempotency-Key' => 'idem-pub-0001'])->assertNotFound();
        $this->getJson('/api/pay/v1/'.PaymentLinkToken::generate().'/status')->assertNotFound();
    }

    #[Test]
    public function an_inactive_tenant_link_looks_like_an_unknown_link(): void
    {
        $token = $this->link($this->invoice());
        DB::table('tenants')->where('id', $this->tenant->id)->update(['is_active' => false]);

        $this->getJson("/api/pay/v1/{$token}")->assertNotFound()->assertJsonPath('error.code', 'link_not_found');
    }

    #[Test]
    public function starting_an_attempt_honours_idempotency_and_the_partial_policy_and_exposes_the_checkout_url_only(): void
    {
        $invoice = $this->invoice();
        $token = $this->link($invoice);

        $this->postJson("/api/pay/v1/{$token}/attempts", [])->assertUnprocessable()->assertJsonPath('error.code', 'invalid_idempotency_key');
        $this->postJson("/api/pay/v1/{$token}/attempts", ['amount_minor' => 5000], ['Idempotency-Key' => 'idem-pub-0002'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'partial_not_allowed');

        $first = $this->postJson("/api/pay/v1/{$token}/attempts", [], ['Idempotency-Key' => 'idem-pub-0003'])->assertCreated()
            ->assertJsonPath('data.amount_minor', 115000)->assertJsonPath('data.capture_status', 'pending_customer')->assertJsonMissingPath('data.id');
        $this->assertNotNull($first->json('data.checkout_url'));
        $again = $this->postJson("/api/pay/v1/{$token}/attempts", [], ['Idempotency-Key' => 'idem-pub-0003'])->assertCreated();
        $this->assertSame($first->json('data.checkout_url'), $again->json('data.checkout_url'));
        $this->assertSame(1, PaymentAttempt::query()->count());
        $this->postJson("/api/pay/v1/{$token}/attempts", [], ['Idempotency-Key' => 'idem-pub-0004'])->assertStatus(409)->assertJsonPath('error.code', 'active_attempt_exists');
        $this->assertSame(0, Payment::query()->count(), 'بدء المحاولة لا أثر محاسبي له');
    }

    #[Test]
    public function a_partial_amount_works_only_on_a_link_that_enabled_it(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner, true);
        $token = $this->requests->issueLink($request, $this->owner);

        $this->postJson("/api/pay/v1/{$token}/attempts", ['amount_minor' => 115001], ['Idempotency-Key' => 'idem-pub-0005'])->assertUnprocessable()->assertJsonPath('error.code', 'amount_exceeds_remaining');
        $this->postJson("/api/pay/v1/{$token}/attempts", ['amount_minor' => 50000], ['Idempotency-Key' => 'idem-pub-0006'])->assertCreated()->assertJsonPath('data.amount_minor', 50000);
    }

    #[Test]
    public function the_status_endpoint_reports_only_a_coarse_payer_facing_state(): void
    {
        $token = $this->link($this->invoice());
        $this->getJson("/api/pay/v1/{$token}/status")->assertOk()->assertJsonPath('data.payment', 'none')->assertJsonPath('data.request_status', 'open');

        $attempt = $this->postJson("/api/pay/v1/{$token}/attempts", [], ['Idempotency-Key' => 'idem-pub-0007'])->assertCreated();
        $this->getJson("/api/pay/v1/{$token}/status")->assertJsonPath('data.payment', 'pending');

        $stored = PaymentAttempt::query()->sole();
        $this->fake->script($stored->provider_payment_id, 'captured');
        app(\App\Services\PaymentOrchestrator::class)->sync($stored);
        $status = $this->getJson("/api/pay/v1/{$token}/status")->assertOk()->assertJsonPath('data.payment', 'paid');
        $this->assertStringNotContainsString('posting', $status->getContent());
        $this->assertStringNotContainsString('captured_minor', $status->getContent());
        $this->assertNotNull($attempt->json('data.checkout_url'));
    }

    #[Test]
    public function closed_cancelled_and_expired_links_expose_status_only_and_refuse_attempts(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $token = $this->requests->issueLink($request, $this->owner);
        $this->requests->cancel($request, $this->owner);

        $this->getJson("/api/pay/v1/{$token}")->assertOk()->assertExactJson(['data' => ['status' => 'cancelled']]);
        $this->postJson("/api/pay/v1/{$token}/attempts", [], ['Idempotency-Key' => 'idem-pub-0008'])->assertStatus(409)->assertJsonPath('error.code', 'request_not_open');

        $invoice2 = $this->invoice();
        $expiring = $this->requests->create($invoice2, $this->gateway, $this->owner, false, now()->addMinutes(5));
        $token2 = $this->requests->issueLink($expiring, $this->owner);
        $this->travel(10)->minutes();
        $this->getJson("/api/pay/v1/{$token2}")->assertOk()->assertExactJson(['data' => ['status' => 'expired']]);
        $this->postJson("/api/pay/v1/{$token2}/attempts", [], ['Idempotency-Key' => 'idem-pub-0009'])->assertStatus(409);
    }

    #[Test]
    public function platform_stop_and_gateway_failures_surface_as_one_generic_unavailable_code(): void
    {
        $token = $this->link($this->invoice());
        app(PaymentsRolloutControlService::class)->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');

        $this->postJson("/api/pay/v1/{$token}/attempts", [], ['Idempotency-Key' => 'idem-pub-0010'])
            ->assertStatus(503)->assertJsonPath('error.code', 'payment_unavailable');
    }

    #[Test]
    public function the_public_endpoints_are_rate_limited_per_token_and_ip(): void
    {
        $token = $this->link($this->invoice());
        $codes = [];
        for ($i = 0; $i < 25; $i++) {
            $codes[] = $this->getJson("/api/pay/v1/{$token}/status")->getStatusCode();
        }
        $this->assertContains(429, $codes);
        $this->assertSame(200, $codes[0]);
    }

    #[Test]
    public function rate_limited_and_unknown_responses_carry_the_capability_url_protection_headers(): void
    {
        $token = $this->link($this->invoice());
        $limited = null;
        for ($i = 0; $i < 25 && ($limited === null || $limited->getStatusCode() !== 429); $i++) {
            $limited = $this->getJson("/api/pay/v1/{$token}/status");
        }
        $this->assertSame(429, $limited->getStatusCode());
        $this->assertSame('no-store, private', $limited->headers->get('Cache-Control'));
        $this->assertSame('no-referrer', $limited->headers->get('Referrer-Policy'));
        $this->assertStringContainsString('noindex', (string) $limited->headers->get('X-Robots-Tag'));

        $unknown = $this->getJson('/api/pay/v1/'.PaymentLinkToken::generate());
        $this->assertSame(404, $unknown->getStatusCode());
        $this->assertSame('no-store, private', $unknown->headers->get('Cache-Control'));
    }

    #[Test]
    public function a_late_capture_of_an_older_attempt_wins_over_a_newer_attempt_in_status_and_blocks_a_second_charge(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $token = $this->requests->issueLink($request, $this->owner);
        $orchestrator = app(\App\Services\PaymentOrchestrator::class);

        $older = $this->requests->startAttempt($request, 'idem-late-0001', null, $this->owner);
        $orchestrator->cancel($older, $this->owner);
        $newer = $this->requests->startAttempt($request, 'idem-late-0002', null, $this->owner);
        $this->assertNotSame($older->id, $newer->id);

        \Illuminate\Support\Facades\Event::fake([\App\Events\PaymentAttemptCaptured::class]);   // الترحيل معلّق: المتبقي لم ينعكس بعد
        $this->fake->script($older->provider_payment_id, 'captured');
        $orchestrator->sync($older->fresh());

        $this->getJson("/api/pay/v1/{$token}/status")->assertOk()->assertJsonPath('data.payment', 'paid');
        $this->assertSame(115000, $invoice->fresh()->remaining(), 'الفاتورة لم تُرحَّل بعد');
        $this->postJson("/api/pay/v1/{$token}/attempts", [], ['Idempotency-Key' => 'idem-late-0003'])
            ->assertStatus(409)->assertJsonPath('error.code', 'payment_captured');
        $e = $this->thrown(fn () => $this->requests->startAttempt($request->fresh(), 'idem-late-0004', null, $this->owner), 'second charge', PaymentOrchestrationException::class);
        $this->assertSame('payment_captured', $e->reason);
    }

    #[Test]
    public function a_posted_partial_payment_reports_partially_paid_and_a_pending_retry_reports_pending(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner, true);
        $token = $this->requests->issueLink($request, $this->owner);
        $orchestrator = app(\App\Services\PaymentOrchestrator::class);

        $first = $this->requests->startAttempt($request, 'idem-part-0001', 50000, $this->owner);
        $this->fake->script($first->provider_payment_id, 'captured');
        $orchestrator->sync($first);     // يُرحَّل فوراً: المتبقي 65000 والطلب مفتوح

        $this->assertSame('open', $request->fresh()->status);
        $this->getJson("/api/pay/v1/{$token}/status")->assertJsonPath('data.payment', 'partially_paid');

        $this->requests->startAttempt($request->fresh(), 'idem-part-0002', null, $this->owner);
        $this->getJson("/api/pay/v1/{$token}/status")->assertJsonPath('data.payment', 'pending');
    }

    #[Test]
    public function the_one_shot_token_is_not_consumed_by_an_expired_or_settled_request(): void
    {
        $expired = $this->requests->create($this->invoice(), $this->gateway, $this->owner, false, now()->addMinutes(5));
        $settledInvoice = $this->invoice();
        $settled = $this->requests->create($settledInvoice, $this->gateway, $this->owner);
        $payments = app(PaymentService::class);
        $payments->post($payments->create(['partner_id' => $settledInvoice->partner_id, 'amount' => 115000, 'direction' => 'received', 'method' => 'cash', 'invoice_id' => $settledInvoice->id]));
        $this->travel(10)->minutes();

        $e = $this->thrown(fn () => $this->requests->issueLink($expired, $this->owner), 'expired issue', PaymentOrchestrationException::class);
        $this->assertSame('request_expired', $e->reason);
        $e = $this->thrown(fn () => $this->requests->issueLink($settled, $this->owner), 'settled issue', PaymentOrchestrationException::class);
        $this->assertSame('invoice_not_payable', $e->reason);
        $this->assertNull($expired->fresh()->token_hash);
        $this->assertNull($settled->fresh()->token_hash);
    }

    #[Test]
    public function a_request_with_an_unposted_captured_payment_is_neither_cancelled_manually_nor_swept(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $attempt = $this->requests->startAttempt($request, 'idem-keep-0001', null, $this->owner);
        \Illuminate\Support\Facades\Event::fake([\App\Events\PaymentAttemptCaptured::class]);   // يبقى الالتقاط pending
        $this->fake->script($attempt->provider_payment_id, 'captured');
        app(\App\Services\PaymentOrchestrator::class)->sync($attempt);
        // الفاتورة سُدّدت بطريقة أخرى فصارت مرشّحة للكنس
        $payments = app(PaymentService::class);
        $payments->post($payments->create(['partner_id' => $invoice->partner_id, 'amount' => 115000, 'direction' => 'received', 'method' => 'cash', 'invoice_id' => $invoice->id]));

        $e = $this->thrown(fn () => $this->requests->cancel($request->fresh(), $this->owner), 'manual cancel', PaymentOrchestrationException::class);
        $this->assertSame('payment_captured', $e->reason);
        $summary = $this->requests->closeStale();

        $this->assertSame(0, $summary['cancelled']);
        $this->assertSame('open', $request->fresh()->status);
        // بعد الترحيل (فائض غير مخصص) يكتمل الطلب أو يبقى مفتوحاً لكنه ليس ملغى
        app(\App\Services\PaymentAttemptPostingService::class)->process($attempt->fresh());
        $this->assertNotSame('cancelled', $request->fresh()->status);
    }

    // ═══════════════ المكنسة ═══════════════

    #[Test]
    public function the_sweeper_cancels_requests_on_settled_invoices_and_expires_overdue_ones_without_any_ledger_effect(): void
    {
        $settled = $this->invoice();
        $settledRequest = $this->requests->create($settled, $this->gateway, $this->owner);
        $payments = app(PaymentService::class);
        $payments->post($payments->create(['partner_id' => $settled->partner_id, 'amount' => 115000, 'direction' => 'received', 'method' => 'cash', 'invoice_id' => $settled->id]));

        $due = $this->invoice();
        $overdue = $this->requests->create($due, $this->gateway, $this->owner, false, now()->addMinutes(5));
        $live = $this->requests->create($this->invoice(), $this->gateway, $this->owner);
        $entries = DB::table('journal_entries')->count();
        $this->travel(10)->minutes();

        $summary = $this->requests->closeStale();

        $this->assertSame(1, $summary['cancelled']);
        $this->assertSame(1, $summary['expired']);
        $this->assertSame('cancelled', $settledRequest->fresh()->status);
        $this->assertSame('expired', $overdue->fresh()->status);
        $this->assertSame('open', $live->fresh()->status);
        $this->assertSame($entries, DB::table('journal_entries')->count());
        $this->assertSame(['cancelled' => 0, 'expired' => 0, 'skipped' => 0], $this->requests->closeStale(), 'idempotent');
        $this->assertSame($this->tenant->id, app(TenantContext::class)->id(), 'المكنسة تعيد السياق السابق');
    }

    #[Test]
    public function long_lived_open_requests_cannot_starve_the_sweep_of_later_settled_ones(): void
    {
        $live = [];
        foreach (range(1, 4) as $i) {
            $live[] = $this->requests->create($this->invoice(), $this->gateway, $this->owner);
        }
        $settled = [];
        foreach (range(1, 2) as $i) {
            $invoice = $this->invoice();
            $settled[] = $this->requests->create($invoice, $this->gateway, $this->owner);
            $payments = app(PaymentService::class);
            $payments->post($payments->create(['partner_id' => $invoice->partner_id, 'amount' => 115000, 'direction' => 'received', 'method' => 'cash', 'invoice_id' => $invoice->id]));
        }

        $summary = $this->requests->closeStale(2);   // الحدّ أصغر من عدد الحيّة القديمة

        $this->assertSame(2, $summary['cancelled']);
        foreach ($settled as $request) {
            $this->assertSame('cancelled', $request->fresh()->status);
        }
        foreach ($live as $request) {
            $this->assertSame('open', $request->fresh()->status);
        }
    }

    #[Test]
    public function skipped_expired_requests_with_active_attempts_do_not_starve_later_stale_ones_and_captured_unposted_ones_are_never_expired(): void
    {
        // طلبان منتهيان بمحاولة نشطة (يُتخطَّيان)، وطلب منتهٍ بالتقاط غير مرحَّل (لا يُنهى)، ثم مسدَّد يجب أن يُكنس رغم limit=1.
        $stuck = [];
        foreach (range(1, 2) as $i) {
            $request = $this->requests->create($this->invoice(), $this->gateway, $this->owner, false, now()->addMinutes(5));
            $this->requests->startAttempt($request, 'idem-skip-000'.$i, null, $this->owner);
            $stuck[] = $request;
        }
        $capturedInvoice = $this->invoice();
        $capturedRequest = $this->requests->create($capturedInvoice, $this->gateway, $this->owner, false, now()->addMinutes(5));
        $attempt = $this->requests->startAttempt($capturedRequest, 'idem-skip-0003', null, $this->owner);
        \Illuminate\Support\Facades\Event::fake([\App\Events\PaymentAttemptCaptured::class]);
        $this->fake->script($attempt->provider_payment_id, 'captured');
        app(\App\Services\PaymentOrchestrator::class)->sync($attempt);

        $settledInvoice = $this->invoice();
        $settled = $this->requests->create($settledInvoice, $this->gateway, $this->owner);
        $payments = app(PaymentService::class);
        $payments->post($payments->create(['partner_id' => $settledInvoice->partner_id, 'amount' => 115000, 'direction' => 'received', 'method' => 'cash', 'invoice_id' => $settledInvoice->id]));
        $this->travel(10)->minutes();

        $summary = $this->requests->closeStale(1);

        $this->assertSame(1, $summary['cancelled'], 'المسدَّد وُصل إليه رغم المتخطّاة قبله');
        $this->assertSame('cancelled', $settled->fresh()->status);
        $this->assertSame('open', $capturedRequest->fresh()->status, 'الالتقاط غير المرحَّل لا يُنهى');
        foreach ($stuck as $request) {
            $this->assertSame('open', $request->fresh()->status);
        }
    }

    #[Test]
    public function the_sweeper_never_cancels_a_request_whose_payment_was_captured_at_the_provider(): void
    {
        $invoice = $this->invoice();
        $request = $this->requests->create($invoice, $this->gateway, $this->owner);
        $attempt = $this->requests->startAttempt($request, 'idem-sweep-0001', null, $this->owner);
        $payments = app(PaymentService::class);
        $payments->post($payments->create(['partner_id' => $invoice->partner_id, 'amount' => 115000, 'direction' => 'received', 'method' => 'cash', 'invoice_id' => $invoice->id]));
        $this->fake->script($attempt->provider_payment_id, 'captured');

        $summary = $this->requests->closeStale();

        $this->assertSame(0, $summary['cancelled']);
        $this->assertSame(1, $summary['skipped']);
        $this->assertNotSame('cancelled', $request->fresh()->status);
    }

    // ═══════════════ أدوات ═══════════════

    private function invoice(): Invoice
    {
        return app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ));
    }

    private function openRequest(): InvoicePaymentRequest
    {
        return $this->requests->create($this->invoice(), $this->gateway, $this->owner);
    }

    private function freshRequest(): InvoicePaymentRequest
    {
        return $this->openRequest();
    }

    private function link(Invoice $invoice): string
    {
        return $this->requests->issueLink($this->requests->create($invoice, $this->gateway, $this->owner), $this->owner);
    }

    private function tokenFor(string $role, string $email): string
    {
        return User::create(['tenant_id' => $this->tenant->id, 'name' => $role, 'email' => $email, 'password' => 'password123', 'role' => $role])->createToken('t')->plainTextToken;
    }
}
