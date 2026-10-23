<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentProviderEvent;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\User;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\MoyasarAdapter;
use App\Services\PaymentGatewayAdapterRegistry;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\InvalidPaymentWebhookException;
use App\Support\PaymentAttemptContext;
use App\Support\PaymentGatewayException;
use App\Support\PaymentOrchestrationException;
use App\Support\PaymentRawWebhook;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H2-01a — محوّل Moyasar (Sandbox، بلا مفاتيح حقيقية): فاتورة مستضافة، حقيقة الاستعلام، الأحداث، الأخطاء والشبكة، سياسة المفاتيح، ولا بطاقة.
 * كل الاستجابات Fixtures بحسب وثائق Moyasar الرسمية (`MoyasarFixtures`)؛ دفعة Sandbox الحقيقية تنتظر EXT-01 (credentials).
 */
class MoyasarAdapterTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private Tenant $tenant;

    private PlatformAdministrator $admin;

    private PaymentGateway $gateway;

    private PaymentOrchestrator $orchestrator;

    private MoyasarAdapter $adapter;

    protected function setUp(): void
    {
        parent::setUp();
        config(['payment_providers.moyasar.retry_sleep_ms' => 0]);

        $this->tenant = Tenant::create(['name' => 'شركة ميسّر', 'slug' => 'pay-h2-01a', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h2-01a.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h2-01a.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->orchestrator = app(PaymentOrchestrator::class);
        $this->adapter = app(MoyasarAdapter::class);
        $this->gateway = $this->activeGateway();
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $this->tenant->id, true, 'تفعيل للاختبار');
    }

    // ═══════════════ إنشاء الصفحة المستضافة ═══════════════

    #[Test]
    public function start_creates_a_hosted_invoice_with_halalas_basic_auth_and_no_card_data(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::sequence()
            ->push(['invoices' => [], 'meta' => ['total_count' => 0]])
            ->push(MoyasarFixtures::invoice(), 201)]);

        $attempt = $this->orchestrator->start(new TestPayable(), $this->gateway, 'idem-moy-0001');

        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, $attempt->capture_status);
        $this->assertSame(MoyasarFixtures::INVOICE_ID, $attempt->provider_payment_id);
        $this->assertSame('https://checkout.moyasar.com/invoices/'.MoyasarFixtures::INVOICE_ID.'?lang=en', $attempt->checkout_url);
        $this->assertNotNull($attempt->expires_at);

        $requests = Http::recorded()->map(fn ($pair) => $pair[0]);
        $this->assertCount(2, $requests);
        /** @var Request $list */
        $list = $requests[0];
        $this->assertSame('GET', $list->method());
        $this->assertSame($attempt->id, $list->data()['metadata']['awj_attempt_id'] ?? $list->data()['metadata[awj_attempt_id]'] ?? null);
        /** @var Request $post */
        $post = $requests[1];
        $this->assertSame('POST', $post->method());
        $this->assertSame('https://api.moyasar.com/v1/invoices', $post->url());
        $this->assertSame('Basic '.base64_encode(MoyasarFixtures::SECRET_KEY.':'), $post->header('Authorization')[0]);
        $body = $post->data();
        $this->assertSame(11500, $body['amount']); // هللات
        $this->assertSame('SAR', $body['currency']);
        $this->assertSame($attempt->id, $body['metadata']['awj_attempt_id']);
        // لا بيانات بطاقة ولا مصدر دفع في أي طلب خارج.
        $this->assertSame([], array_intersect(['source', 'number', 'cvc', 'card', 'name', 'month', 'year', 'token'], array_keys($body)));
        $this->assertStringNotContainsString(MoyasarFixtures::SECRET_KEY, json_encode($body));
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function the_lookup_and_create_decision_is_serialized_per_attempt_by_a_lock_held_across_the_post(): void
    {
        $heldDuringPost = null;
        $attemptId = null;
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => function (Request $request) use (&$heldDuringPost, &$attemptId) {
            if ($request->method() === 'GET') {
                return Http::response(['invoices' => []]);
            }
            $attemptId = $request->data()['metadata']['awj_attempt_id'];
            $competing = Cache::lock('moyasar:checkout:'.$attemptId, 5);
            $heldDuringPost = ! $competing->get(); // قفل المحاولة محجوز أثناء الإنشاء ⇒ طلب متزامن لا يدخل
            if (! $heldDuringPost) {
                $competing->release();
            }

            return Http::response(MoyasarFixtures::invoice(attemptId: $attemptId), 201);
        }]);

        $this->orchestrator->start(new TestPayable(), $this->gateway, 'idem-moy-lock-1');

        $this->assertTrue($heldDuringPost);
        // وبعد الانتهاء يُحرَّر القفل.
        $after = Cache::lock('moyasar:checkout:'.$attemptId, 5);
        $this->assertTrue($after->get());
        $after->release();
    }

    #[Test]
    public function a_lost_response_resumes_the_same_invoice_instead_of_creating_a_second_one(): void
    {
        $key = 'idem-moy-0002';
        // المحاولة الأولى: إنشاء الفاتورة ينجح لدى المزوّد لكن الاستجابة تضيع (500) ⇒ المحاولة تبقى created.
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::sequence()->push(['invoices' => []])->push(['message' => 'boom'], 500)]);
        $this->expectProviderUnavailable(fn () => $this->orchestrator->start(new TestPayable(), $this->gateway, $key));
        $attempt = PaymentAttempt::query()->where('idempotency_key', $key)->firstOrFail();
        $this->assertSame(PaymentAttempt::STATUS_CREATED, $attempt->capture_status);

        // إعادة الطلب بالمفتاح نفسه: البحث بالـmetadata يجد الفاتورة التي أُنشئت فعلاً ⇒ لا POST ثانٍ.
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::response(['invoices' => [MoyasarFixtures::invoice(attemptId: $attempt->id)]])]);
        $resumed = $this->orchestrator->start(new TestPayable(), $this->gateway, $key);

        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, $resumed->capture_status);
        $this->assertSame(MoyasarFixtures::INVOICE_ID, $resumed->provider_payment_id);
        Http::assertSent(fn (Request $r) => $r->method() === 'GET');
        Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
    }

    #[Test]
    public function an_existing_invoice_with_a_different_amount_is_a_conflict_not_a_silent_reuse(): void
    {
        $context = $this->context(11500);
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::response(['invoices' => [MoyasarFixtures::invoice(amount: 9900, attemptId: $context->attemptId)]])]);

        $e = $this->thrown(fn () => $this->adapter->createCheckout($context), 'conflict expected', PaymentGatewayException::class);

        $this->assertSame('moyasar.invoice_conflict', $e->reason);
        Http::assertNotSent(fn (Request $r) => $r->method() === 'POST');
    }

    #[Test]
    public function an_amount_below_the_provider_minimum_is_rejected_before_any_network_call(): void
    {
        $this->fakeHttp([]);
        $e = $this->thrown(fn () => $this->adapter->createCheckout($this->context(99)), 'minimum expected', PaymentGatewayException::class);

        $this->assertSame('moyasar.amount_below_minimum', $e->reason);
        Http::assertNothingSent();
    }

    #[Test]
    public function a_sub_minimum_payable_is_rejected_before_any_attempt_is_persisted_so_the_payable_never_gets_stuck(): void
    {
        $this->fakeHttp([]);

        $e = $this->thrown(fn () => $this->orchestrator->start(new TestPayable(due: 99), $this->gateway, 'idem-moy-min-1'), 'minimum expected', PaymentOrchestrationException::class);

        $this->assertSame('amount_below_minimum', $e->reason);
        $this->assertSame(0, PaymentAttempt::query()->count());
        Http::assertNothingSent();
        // والمبلغ المقبول بعدها يبدأ طبيعياً: لا محاولة نشطة عالقة.
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::sequence()->push(['invoices' => []])->push(MoyasarFixtures::invoice(), 201)]);
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, $this->orchestrator->start(new TestPayable(), $this->gateway, 'idem-moy-min-2')->capture_status);
    }

    #[Test]
    public function a_checkout_url_outside_the_provider_domain_or_without_https_is_refused(): void
    {
        foreach (['https://evil.example/pay', 'http://evil.example/invoices/x', 'http://moyasar.com.evil.example/x', 'https://moyasar.com.evil.example/x', 'javascript:alert(1)'] as $url) {
            $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::sequence()->push(['invoices' => []])->push(array_merge(MoyasarFixtures::invoice(), ['url' => $url]), 201)]);
            $e = $this->thrown(fn () => $this->adapter->createCheckout($this->context(11500)), "untrusted url {$url}", PaymentGatewayException::class);
            $this->assertSame('moyasar.malformed_response', $e->reason, $url);
        }
    }

    #[Test]
    public function the_documented_http_checkout_url_on_the_trusted_host_is_upgraded_to_https(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::sequence()->push(['invoices' => []])->push(array_merge(MoyasarFixtures::invoice(), ['url' => 'http://checkout.moyasar.com/invoices/'.MoyasarFixtures::INVOICE_ID.'?lang=en']), 201)]);

        $checkout = $this->adapter->createCheckout($this->context(11500));

        $this->assertSame('https://checkout.moyasar.com/invoices/'.MoyasarFixtures::INVOICE_ID.'?lang=en', $checkout->checkoutUrl);
    }

    #[Test]
    public function the_checkout_lock_outlives_the_worst_case_lookup_retries_plus_create(): void
    {
        config(['payment_providers.moyasar.timeout_seconds' => 15, 'payment_providers.moyasar.read_retries' => 2, 'payment_providers.moyasar.retry_sleep_ms' => 200]);
        $method = new \ReflectionMethod(MoyasarAdapter::class, 'checkoutLockSeconds');
        $method->setAccessible(true);

        // 3 قراءات × 15 ث + POST 15 ث = 60 ث قبل الفواصل والهامش.
        $this->assertGreaterThanOrEqual(60 + 1, $method->invoke($this->adapter));
    }

    // ═══════════════ الأخطاء والشبكة ═══════════════

    #[Test]
    #[DataProvider('httpFailures')]
    public function http_failures_become_typed_errors_without_leaking_secrets_or_bodies(int $status, string $reason): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(['message' => 'detail '.MoyasarFixtures::SECRET_KEY], $status)]);

        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'error expected', PaymentGatewayException::class);

        $this->assertSame($reason, $e->reason);
        $this->assertStringNotContainsString(MoyasarFixtures::SECRET_KEY, $e->getMessage());
    }

    /** @return array<string, array{int, string}> */
    public static function httpFailures(): array
    {
        return [
            '401' => [401, 'moyasar.unauthorized'], '403' => [403, 'moyasar.unauthorized'], '404' => [404, 'moyasar.not_found'],
            '400' => [400, 'moyasar.rejected'], '422' => [422, 'moyasar.rejected'], '429' => [429, 'moyasar.rate_limited'],
            '500' => [500, 'moyasar.unavailable'], '503' => [503, 'moyasar.unavailable'],
        ];
    }

    #[Test]
    public function a_non_json_success_body_is_a_malformed_response(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response('<html>gateway</html>', 200)]);
        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'malformed expected', PaymentGatewayException::class);
        $this->assertSame('moyasar.malformed_response', $e->reason);
    }

    #[Test]
    public function reads_retry_on_connection_loss_but_the_create_post_is_never_retried(): void
    {
        $calls = 0;
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => function () use (&$calls) {
            if (++$calls < 3) {
                throw new ConnectionException('cURL error 28: timed out');
            }

            return Http::response(MoyasarFixtures::invoice());
        }]);
        $this->assertSame('pending_customer', $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID)->status);
        $this->assertSame(3, $calls);

        $posts = 0;
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => function (Request $r) use (&$posts) {
            if ($r->method() === 'GET') {
                return Http::response(['invoices' => []]);
            }
            $posts++;
            throw new ConnectionException('reset by peer');
        }]);
        $e = $this->thrown(fn () => $this->adapter->createCheckout($this->context(11500)), 'unavailable expected', PaymentGatewayException::class);
        $this->assertSame('moyasar.unavailable', $e->reason);
        $this->assertSame(1, $posts, 'POST بلا إعادة محاولة تلقائية');
    }

    #[Test]
    public function exhausted_read_retries_end_as_unavailable(): void
    {
        $calls = 0;
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => function () use (&$calls) {
            $calls++;
            throw new ConnectionException('down');
        }]);
        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'unavailable expected', PaymentGatewayException::class);
        $this->assertSame('moyasar.unavailable', $e->reason);
        $this->assertSame(3, $calls, 'محاولة + إعادتان');
    }

    // ═══════════════ لقطات الحقيقة ═══════════════

    /** @param array<string, mixed> $invoice */
    #[Test]
    #[DataProvider('snapshots')]
    public function provider_state_maps_to_a_monotonic_attempt_snapshot(array $invoice, string $status, int $captured, ?string $failure = null): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response($invoice)]);

        $snapshot = $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID);

        $this->assertSame($status, $snapshot->status);
        $this->assertSame($captured, $snapshot->capturedMinor);
        $this->assertSame($failure, $snapshot->failureCode);
        $this->assertSame(11500, $snapshot->amountMinor);
        $this->assertSame('SAR', $snapshot->currency);
        $this->assertSame($status === 'captured', $snapshot->capturedAt !== null);
    }

    /** @return array<string, array<int, mixed>> */
    public static function snapshots(): array
    {
        $paid = MoyasarFixtures::payment('paid');

        return [
            'initiated, no payment yet' => [MoyasarFixtures::invoice('initiated'), 'pending_customer', 0],
            '3DS challenge pending' => [MoyasarFixtures::invoice('initiated', payments: [MoyasarFixtures::payment('initiated')]), 'pending_customer', 0],
            'declined card, invoice still payable' => [MoyasarFixtures::invoice('failed', payments: [MoyasarFixtures::payment('failed', responseCode: '5001')]), 'pending_customer', 0, '5001'],
            'declined without code' => [MoyasarFixtures::invoice('initiated', payments: [MoyasarFixtures::payment('failed')]), 'pending_customer', 0, 'payment_failed'],
            'paid' => [MoyasarFixtures::invoice('paid', payments: [$paid]), 'captured', 11500],
            'paid after an earlier failure' => [MoyasarFixtures::invoice('paid', payments: [MoyasarFixtures::payment('failed', id: 'f1'), $paid]), 'captured', 11500, 'payment_failed'],
            'partial payment' => [MoyasarFixtures::invoice('paid', payments: [MoyasarFixtures::payment('paid', 5000)]), 'captured', 5000],
            'partial capture of a larger authorization' => [MoyasarFixtures::invoice('paid', payments: [array_merge(MoyasarFixtures::payment('paid'), ['captured' => 5000])]), 'captured', 5000],
            'captured never exceeds the payment amount' => [MoyasarFixtures::invoice('paid', payments: [array_merge(MoyasarFixtures::payment('paid'), ['captured' => 99999])]), 'captured', 11500],
            'captured zero on a paid payment falls back to the full amount' => [MoyasarFixtures::invoice('paid', payments: [array_merge(MoyasarFixtures::payment('paid'), ['captured' => 0])]), 'captured', 11500],
            'refunded payment was paid' => [MoyasarFixtures::invoice('refunded', payments: [MoyasarFixtures::payment('refunded')]), 'captured', 11500],
            'authorized only' => [MoyasarFixtures::invoice('initiated', payments: [MoyasarFixtures::payment('authorized')]), 'authorized', 0],
            'expired' => [MoyasarFixtures::invoice('expired'), 'expired', 0],
            'canceled' => [MoyasarFixtures::invoice('canceled'), 'cancelled', 0],
            'voided invoice' => [MoyasarFixtures::invoice('voided'), 'cancelled', 0],
            'lowercase currency from provider' => [array_merge(MoyasarFixtures::invoice('initiated'), ['currency' => 'sar']), 'pending_customer', 0],
        ];
    }

    #[Test]
    public function a_paid_invoice_without_a_settled_payment_is_never_taken_as_captured(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', payments: []))]);
        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'no evidence expected', PaymentGatewayException::class);
        $this->assertSame('moyasar.malformed_response', $e->reason);
    }

    #[Test]
    public function a_response_for_another_invoice_is_a_reference_mismatch(): void
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', payments: [MoyasarFixtures::payment('paid')], id: 'other-invoice'))]);
        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway, MoyasarFixtures::INVOICE_ID), 'mismatch expected', PaymentGatewayException::class);
        $this->assertSame('moyasar.reference_mismatch', $e->reason);
    }

    // ═══════════════ المنسّق: تكرار وتأخير وترتيب ═══════════════

    #[Test]
    public function sync_applies_provider_truth_once_and_a_duplicate_or_stale_snapshot_changes_nothing(): void
    {
        $attempt = $this->startedAttempt();

        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', payments: [MoyasarFixtures::payment('paid')]))]);
        $first = $this->orchestrator->sync($attempt);
        $this->assertTrue($first->applied);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, $first->attempt->capture_status);
        $this->assertSame(11500, (int) $first->attempt->captured_minor);

        $second = $this->orchestrator->sync($attempt);
        $this->assertFalse($second->applied);
        $this->assertSame('duplicate', $second->ignoredReason);

        // لقطة أقدم/أدنى رتبة بعد الالتقاط (حدث متأخر): لا أثر.
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('initiated'))]);
        $stale = $this->orchestrator->sync($attempt);
        $this->assertFalse($stale->applied);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function a_late_payment_after_local_expiry_is_captured_and_flagged_for_review(): void
    {
        $attempt = $this->startedAttempt();
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('expired'))]);
        $this->orchestrator->sync($attempt);
        $this->assertSame(PaymentAttempt::STATUS_EXPIRED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);

        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', payments: [MoyasarFixtures::payment('paid')]))]);
        $late = $this->orchestrator->sync($attempt);

        $this->assertTrue($late->applied);
        $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, $late->attempt->review_reasons);
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function a_provider_amount_that_differs_from_the_attempt_is_flagged_not_trusted(): void
    {
        $attempt = $this->startedAttempt();
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', payments: [MoyasarFixtures::payment('paid', 5000)]))]);

        $result = $this->orchestrator->sync($attempt);

        $this->assertContains(PaymentAttempt::REVIEW_AMOUNT_MISMATCH, $result->attempt->review_reasons);
        $this->assertSame(5000, (int) $result->attempt->captured_minor);
    }

    // ═══════════════ الـwebhook ═══════════════

    #[Test]
    public function a_valid_event_only_triggers_a_provider_query_and_a_lying_body_changes_nothing(): void
    {
        $attempt = $this->startedAttempt();
        // الجسم يقول «paid» لكن المزوّد (الحقيقة) يقول initiated: لا التقاط.
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('initiated'))]);

        $this->deliver(MoyasarFixtures::event('payment_paid', 'evt-lie'))->assertOk()->assertJson(['status' => 'ok']);

        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function a_paid_event_then_a_trusted_query_captures_and_the_stored_body_carries_no_secret(): void
    {
        $attempt = $this->startedAttempt();
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', payments: [MoyasarFixtures::payment('paid')]))]);
        $event = MoyasarFixtures::event('payment_paid', 'evt-ok');
        $event['data']['source'] = array_merge($event['data']['source'], [
            'token' => 'token_SENSITIVE_1234', 'name' => 'HOLDER SENSITIVE', 'number' => '4111XXXXXXXX1111', 'message' => 'AUTH_SENSITIVE_3DS',
        ]);
        $event['data']['authentication'] = ['cavv' => 'CAVV_SENSITIVE'];
        $raw = json_encode($event);

        $this->deliver($raw)->assertOk();

        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
        $event = PaymentProviderEvent::query()->firstOrFail();
        $this->assertSame('evt-ok', $event->provider_event_id);
        $this->assertSame(MoyasarFixtures::INVOICE_ID, $event->provider_payment_id);
        $this->assertSame(hash('sha256', $raw), $event->body_hash);
        $this->assertStringNotContainsString(MoyasarFixtures::WEBHOOK_SECRET, (string) $event->body);
        foreach (['SENSITIVE', '4111', 'token_', 'cavv', 'source'] as $needle) {
            $this->assertStringNotContainsString($needle, (string) $event->body, $needle);
        }
        $stored = json_decode((string) $event->body, true);
        $this->assertTrue($stored['redacted']);
        $this->assertEqualsCanonicalizing(['id' => MoyasarFixtures::payment('paid')['id'], 'invoice_id' => MoyasarFixtures::INVOICE_ID, 'status' => 'paid', 'amount' => 11500, 'currency' => 'SAR'], $stored['data']);
        $this->assertStringNotContainsString(MoyasarFixtures::WEBHOOK_SECRET, json_encode(DB::table('payment_provider_events')->get()->all()));
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function wrong_missing_expired_previous_or_live_tokens_are_rejected_and_nothing_is_stored(): void
    {
        $this->startedAttempt();
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice())]);

        $this->deliver(MoyasarFixtures::event(token: 'wrong'))->assertUnauthorized();
        $this->deliver(MoyasarFixtures::event(token: ''))->assertUnauthorized();
        $without = MoyasarFixtures::event();
        unset($without['secret_token']);
        $this->deliver($without)->assertUnauthorized();
        $this->deliver(MoyasarFixtures::event(live: true))->assertUnauthorized(); // سرّ صحيح لكن حدث حيّ على اتصال Sandbox

        // سرّ سابق منتهي النافذة لا يُقبل؛ ضمن النافذة يُقبل.
        $this->gateway->forceFill(['previous_webhook_secret' => 'old-secret-token', 'previous_secret_expires_at' => now()->subMinute()])->save();
        $this->deliver(MoyasarFixtures::event(token: 'old-secret-token', eventId: 'evt-old'))->assertUnauthorized();
        $this->gateway->forceFill(['previous_secret_expires_at' => now()->addHour()])->save();
        $this->deliver(MoyasarFixtures::event(token: 'old-secret-token', eventId: 'evt-grace'))->assertOk();

        $this->assertSame(['evt-grace'], PaymentProviderEvent::query()->pluck('provider_event_id')->all());
        Http::assertSentCount(1); // الحدث المقبول وحده أطلق استعلاماً
    }

    #[Test]
    public function an_unparsable_or_incomplete_authenticated_body_is_a_400(): void
    {
        $this->deliver('not json')->assertStatus(400);
        $noId = MoyasarFixtures::event();
        unset($noId['id']);
        $this->deliver($noId)->assertStatus(400);
        $noType = MoyasarFixtures::event();
        unset($noType['type']);
        $this->deliver($noType)->assertStatus(400);
        $this->assertSame(0, PaymentProviderEvent::query()->count());
    }

    #[Test]
    public function duplicate_retries_are_idempotent_and_a_same_id_different_body_is_a_conflict(): void
    {
        $this->startedAttempt();
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', payments: [MoyasarFixtures::payment('paid')]))]);
        $event = MoyasarFixtures::event('payment_paid', 'evt-dup');

        $this->deliver($event)->assertOk();
        $this->deliver($event)->assertOk()->assertJson(['status' => 'duplicate']);
        $this->deliver(array_merge($event, ['created_at' => '2030-01-01T00:00:00.000Z']))->assertStatus(409);

        $this->assertSame(1, PaymentProviderEvent::query()->count());
    }

    #[Test]
    public function events_without_a_matching_invoice_are_unmatched_and_never_query_the_provider(): void
    {
        $this->startedAttempt();
        $this->fakeHttp();

        $this->deliver(MoyasarFixtures::event('payment_paid', 'evt-unknown', 'unknown-invoice'))->assertOk()->assertJson(['status' => 'unmatched']);
        $this->deliver(MoyasarFixtures::event('payment_paid', 'evt-direct', null))->assertOk()->assertJson(['status' => 'unmatched']);
        $this->deliver(MoyasarFixtures::event('card_auth_authenticated', 'evt-3ds'))->assertOk()->assertJson(['status' => 'unmatched']);

        Http::assertNothingSent();
    }

    #[Test]
    public function a_provider_outage_during_event_handling_is_a_retryable_503_and_the_event_survives(): void
    {
        $attempt = $this->startedAttempt();
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => fn () => throw new ConnectionException('down')]);
        $event = MoyasarFixtures::event('payment_paid', 'evt-503');

        $this->deliver($event)->assertStatus(503);
        $this->assertSame(PaymentProviderEvent::STATUS_RECEIVED, PaymentProviderEvent::query()->firstOrFail()->status);

        // المزوّد يعيد الإرسال بعد التعافي ⇒ يكتمل الحدث نفسه.
        $this->fakeHttp(['api.moyasar.com/v1/invoices/*' => Http::response(MoyasarFixtures::invoice('paid', payments: [MoyasarFixtures::payment('paid')]))]);
        $this->deliver($event)->assertOk();
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
        $this->assertSame(1, PaymentProviderEvent::query()->count());
    }

    #[Test]
    public function another_tenants_connection_neither_accepts_this_secret_nor_matches_this_invoice(): void
    {
        $attempt = $this->startedAttempt();
        $other = Tenant::create(['name' => 'مستأجر آخر', 'slug' => 'pay-h2-01a-b', 'vat_number' => '300000000000021', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $foreign = PaymentGateway::query()->create([
            'provider' => 'moyasar', 'name' => 'Moyasar B', 'environment' => 'sandbox',
            'secret_key' => 'sk_test_other_tenant_0002', 'publishable_key' => 'pk_test_other_tenant_0002', 'webhook_secret' => 'other-tenant-token',
        ]);
        DB::table('payment_gateways')->where('id', $foreign->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);
        $foreign = $foreign->fresh();
        app(TenantContext::class)->set($this->tenant->id);
        $this->fakeHttp();

        // سرّ المستأجر الأول على رابط الثاني ⇒ 401.
        $this->postJson("/api/payment-webhooks/moyasar/{$foreign->webhook_key}", MoyasarFixtures::event())->assertUnauthorized();
        // حدث بسرّ الثاني لفاتورة المستأجر الأول ⇒ لا تطابق (البحث مقيّد باتصال المستلِم) ولا استعلام.
        $this->postJson("/api/payment-webhooks/moyasar/{$foreign->webhook_key}", MoyasarFixtures::event(token: 'other-tenant-token'))->assertOk()->assertJson(['status' => 'unmatched']);

        Http::assertNothingSent();
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
    }

    // ═══════════════ سياسة المفاتيح والمنع ═══════════════

    #[Test]
    public function the_api_rejects_live_keys_wrong_key_kinds_and_the_live_environment(): void
    {
        $auth = $this->registerTenant('h2-keys', 'owner@h2-keys.test');
        $post = fn (array $over) => $this->withToken($auth['token'])->postJson('/api/payment-gateways', array_merge([
            'provider' => 'moyasar', 'name' => 'Moyasar '.uniqid(), 'environment' => 'sandbox',
            'publishable_key' => 'pk_test_ok_0001', 'secret_key' => 'sk_test_ok_0001', 'webhook_secret' => 'tok',
        ], $over));

        $post([])->assertCreated()->assertJsonPath('data.provider', 'moyasar');
        $post(['secret_key' => 'sk_live_real_looking'])->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_live_key_in_sandbox');
        $post(['publishable_key' => 'pk_live_real_looking'])->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_live_key_in_sandbox');
        $post(['secret_key' => 'pk_test_wrong_slot'])->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_key_type_mismatch');
        $post(['publishable_key' => 'sk_test_wrong_slot'])->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_key_type_mismatch');
        $post(['secret_key' => 'something-else'])->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_invalid_key_format');
        $post(['environment' => 'live', 'secret_key' => 'sk_live_x', 'publishable_key' => 'pk_live_x'])->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_live_not_enabled');
        $post(['environment' => 'live'])->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_live_not_enabled');
    }

    #[Test]
    public function rotating_to_a_live_key_is_rejected_and_the_stored_secret_is_untouched(): void
    {
        $auth = $this->registerTenant('h2-rot', 'owner@h2-rot.test');
        $id = $this->withToken($auth['token'])->postJson('/api/payment-gateways', [
            'provider' => 'moyasar', 'name' => 'Moyasar R', 'environment' => 'sandbox', 'secret_key' => 'sk_test_rot_0001', 'publishable_key' => 'pk_test_rot_0001',
        ])->assertCreated()->json('data.id');

        $this->withToken($auth['token'])->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['secret_key' => 'sk_live_rot_0002'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_live_key_in_sandbox');
        $this->withToken($auth['token'])->putJson("/api/payment-gateways/{$id}", ['publishable_key' => 'pk_live_rot_0002'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_live_key_in_sandbox');

        $this->assertSame('sk_test_rot_0001', PaymentGateway::query()->withoutGlobalScopes()->findOrFail($id)->secret_key);
    }

    #[Test]
    public function a_row_written_outside_the_service_with_a_live_key_still_cannot_reach_the_network(): void
    {
        $this->fakeHttp();
        $this->gateway->forceFill(['secret_key' => 'sk_live_smuggled_0001'])->save();

        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway->fresh(), MoyasarFixtures::INVOICE_ID), 'live key expected to be refused', PaymentGatewayException::class);

        $this->assertSame('gateway.moyasar_live_key_in_sandbox', $e->reason);
        Http::assertNothingSent();

        $this->gateway->forceFill(['secret_key' => null])->save();
        $e = $this->thrown(fn () => $this->adapter->fetchPayment($this->gateway->fresh(), MoyasarFixtures::INVOICE_ID), 'missing key expected', PaymentGatewayException::class);
        $this->assertSame('moyasar.credentials_missing', $e->reason);
        Http::assertNothingSent();
    }

    #[Test]
    public function the_fake_adapter_is_unavailable_in_production_and_moyasar_is_registered(): void
    {
        $this->assertContains('moyasar', PaymentGateway::PROVIDERS);
        $this->app['env'] = 'production';
        $registry = app(PaymentGatewayAdapterRegistry::class);

        $this->assertFalse($registry->has(FakePaymentGatewayAdapter::PROVIDER));
        $this->assertTrue($registry->has('moyasar'));
        $this->assertInstanceOf(MoyasarAdapter::class, $registry->for('moyasar'));
    }

    #[Test]
    public function the_moyasar_layer_has_no_card_fields_and_never_touches_the_ledger_or_vouchers(): void
    {
        foreach (['app/Services/MoyasarAdapter.php', 'app/Services/MoyasarApiClient.php', 'app/Support/MoyasarCredentialPolicy.php'] as $file) {
            $source = $this->codeWithoutComments((string) file_get_contents(base_path($file)));
            $this->assertDoesNotMatchRegularExpression('/\b(cvc|cvv|card_number|creditcard|[\'"]source[\'"])\b/i', $source, "{$file}: بيانات بطاقة");
            $this->assertDoesNotMatchRegularExpression('/\b(LedgerService|PaymentService|JournalEntry|InvoiceService|ZatcaService)\b/', $source, "{$file}: لمس الدفتر");
            $this->assertDoesNotMatchRegularExpression('/[\'"]\/payments/', $source, "{$file}: مسار /payments (إنشاء دفعة ببطاقة) ممنوع");
        }
        $rules = (new \App\Http\Requests\StorePaymentGatewayRequest())->rules();
        $this->assertSame([], array_intersect(['card', 'card_number', 'number', 'cvc', 'cvv', 'source'], array_keys($rules)));
    }

    // ═══════════════ مساعدات ═══════════════

    private function codeWithoutComments(string $php): string
    {
        $out = '';
        foreach (token_get_all($php) as $token) {
            if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $out .= is_array($token) ? $token[1] : $token;
        }

        return $out;
    }

    /** كل استدعاء ينسخ مصنع HTTP جديداً: `Http::fake` يحتفظ بأول قالب مطابق فلا تُلغي تعريفات لاحقة سابقاً. */
    private function fakeHttp(array $stubs = []): void
    {
        Http::swap(new HttpFactory());
        Http::fake($stubs === [] ? null : $stubs);
    }

    private function activeGateway(): PaymentGateway
    {
        $gateway = PaymentGateway::query()->create([
            'provider' => 'moyasar', 'name' => 'Moyasar Sandbox', 'environment' => 'sandbox',
            'secret_key' => MoyasarFixtures::SECRET_KEY, 'publishable_key' => MoyasarFixtures::PUBLISHABLE_KEY, 'webhook_secret' => MoyasarFixtures::WEBHOOK_SECRET,
        ]);
        // مزوّد حقيقي يشترط `verified_at` للاستعمال؛ إجراء التحقق نفسه شريحة H2-01b — هنا يُفرض مباشرة لعزل المحوّل.
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true, 'verified_at' => now()]);

        return $gateway->fresh();
    }

    private function startedAttempt(): PaymentAttempt
    {
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::sequence()->push(['invoices' => []])->push(MoyasarFixtures::invoice(), 201)]);

        return $this->orchestrator->start(new TestPayable(), $this->gateway, 'idem-moy-'.uniqid());
    }

    private function context(int $amount): PaymentAttemptContext
    {
        return new PaymentAttemptContext($this->gateway, '11111111-2222-4333-8444-555555555555', $amount, 'SAR', 'invoice:inv-1');
    }

    private function expectProviderUnavailable(callable $operation): void
    {
        $e = $this->thrown($operation, 'provider_unavailable expected', PaymentOrchestrationException::class);
        $this->assertSame('provider_unavailable', $e->reason);
    }

    /** @param array<string, mixed>|string $event */
    private function deliver(array|string $event): \Illuminate\Testing\TestResponse
    {
        return $this->call(
            'POST',
            "/api/payment-webhooks/moyasar/{$this->gateway->webhook_key}",
            [], [], [],
            ['CONTENT_TYPE' => 'application/json'],
            is_string($event) ? $event : json_encode($event),
        );
    }

    private function assertNoFinancialArtifacts(): void
    {
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }
}
