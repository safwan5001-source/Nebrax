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
use App\Services\PaymentGatewayService;
use App\Services\PaymentOrchestrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** PAY-H1-04 — صندوق أحداث المزوّد: توقيع، dedupe، حد الحجم، استعلام موثوق، أحداث متأخرة، عزل، مطابقة يدوية. */
class PaymentWebhookInboxTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private const SECRET = 'whsec_inbox_test';

    private Tenant $tenant;

    private User $owner;

    private PaymentGateway $gateway;

    private PlatformAdministrator $admin;

    private FakePaymentGatewayAdapter $fake;

    private PaymentOrchestrator $orchestrator;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create(['name' => 'شركة الصندوق', 'slug' => 'pay-h1-04', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        $this->owner = User::create(['tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@pay-h1-04.test', 'password' => 'password123', 'role' => 'owner']);
        $this->admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@pay-h1-04.test', 'password' => 'platform-password-123']);
        SchedulerHeartbeat::record();
        $this->app->singleton(FakePaymentGatewayAdapter::class);
        $this->fake = app(FakePaymentGatewayAdapter::class);
        $this->orchestrator = app(PaymentOrchestrator::class);
        $this->gateway = $this->activeGateway();
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $this->tenant->id, true, 'تفعيل للاختبار');
    }

    // ═══════════════ التوقيع والاستقبال ═══════════════

    #[Test]
    public function a_signed_event_is_stored_encrypted_and_triggers_a_trusted_provider_query_not_the_body(): void
    {
        $attempt = $this->pendingAttempt('invoice:ev-1', 'idem-ev-0001');
        $this->fake->script($attempt->provider_payment_id, 'captured');
        // الجسم يدّعي «failed» لكن الحقيقة من المزوّد: يُهمَل ما في الجسم.
        $body = $this->body('evt_1', $attempt->provider_payment_id, 'payment.failed');

        $response = $this->deliver($body);

        $response->assertOk()->assertJson(['status' => 'ok']);
        $this->assertSame(1, $this->fake->fetchCount);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);

        $event = PaymentProviderEvent::query()->firstOrFail();
        $this->assertSame('evt_1', $event->provider_event_id);
        $this->assertSame(PaymentProviderEvent::STATUS_PROCESSED, $event->status);
        $this->assertSame('applied', $event->outcome);
        $this->assertSame($attempt->id, $event->payment_attempt_id);
        $this->assertSame(hash('sha256', $body), $event->body_hash);
        $this->assertSame($body, $event->body);
        $raw = (string) DB::table('payment_provider_events')->value('body');
        $this->assertStringNotContainsString('evt_1', $raw, 'الجسم مشفَّر في القاعدة');
        $this->assertNoFinancialArtifacts();
    }

    #[Test]
    public function a_wrong_missing_or_foreign_signature_is_rejected_and_nothing_is_stored(): void
    {
        $attempt = $this->pendingAttempt('invoice:ev-2', 'idem-ev-0002');
        $body = $this->body('evt_bad', $attempt->provider_payment_id);

        $this->deliver($body, signature: FakePaymentGatewayAdapter::sign($body, 'another_secret'))->assertUnauthorized();
        $this->deliver($body, signature: '')->assertUnauthorized();
        $this->deliver($body, signature: FakePaymentGatewayAdapter::sign('{"id":"other"}', self::SECRET))->assertUnauthorized();

        $this->assertSame(0, PaymentProviderEvent::query()->count());
        $this->assertSame(0, $this->fake->fetchCount);
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
    }

    #[Test]
    public function a_correctly_signed_but_unintelligible_body_is_a_400_and_not_stored(): void
    {
        $this->deliver('not json at all')->assertStatus(400);
        $this->deliver('{"type":"x"}')->assertStatus(400);

        $this->assertSame(0, PaymentProviderEvent::query()->count());
    }

    #[Test]
    public function an_unknown_key_provider_inactive_connection_or_tenant_is_a_plain_404(): void
    {
        $body = $this->body('evt_404', 'fake_x');
        $sig = FakePaymentGatewayAdapter::sign($body, self::SECRET);
        $post = fn (string $provider, string $key) => $this->call('POST', "/api/payment-webhooks/{$provider}/{$key}", [], [], [], ['HTTP_X_FAKE_SIGNATURE' => $sig, 'CONTENT_TYPE' => 'application/json'], $body);

        $post('fake', str_repeat('a', 64))->assertNotFound();
        $post('stripe', $this->gateway->webhook_key)->assertNotFound(); // مزوّد لا يطابق الاتصال
        $post('nofake', $this->gateway->webhook_key)->assertNotFound();

        foreach ([PaymentGateway::STATUS_DRAFT, PaymentGateway::STATUS_REVOKED] as $status) {
            DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => $status]);
            $post('fake', $this->gateway->webhook_key)->assertNotFound();
        }
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE]);
        DB::table('tenants')->where('id', $this->tenant->id)->update(['is_active' => false]);
        $post('fake', $this->gateway->webhook_key)->assertNotFound();

        $this->assertSame(0, PaymentProviderEvent::query()->withoutGlobalScopes()->count());
    }

    #[Test]
    public function a_suspended_connection_still_receives_events_so_late_captures_are_not_lost(): void
    {
        $attempt = $this->pendingAttempt('invoice:ev-3', 'idem-ev-0003');
        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['status' => PaymentGateway::STATUS_SUSPENDED]);
        $this->fake->script($attempt->provider_payment_id, 'captured');

        $this->deliver($this->body('evt_susp', $attempt->provider_payment_id))->assertOk();

        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
    }

    #[Test]
    public function an_oversized_body_is_refused_before_anything_else(): void
    {
        $body = json_encode(['id' => 'evt_big', 'payment_id' => 'x', 'pad' => str_repeat('a', PaymentProviderEvent::MAX_BODY_BYTES)]);
        $this->assertGreaterThan(PaymentProviderEvent::MAX_BODY_BYTES, strlen((string) $body));

        $this->deliver((string) $body)->assertStatus(413);

        $this->assertSame(0, PaymentProviderEvent::query()->count());
        $this->assertSame(0, $this->fake->fetchCount);
    }

    // ═══════════════ dedupe ═══════════════

    #[Test]
    public function a_duplicate_delivery_is_a_replay_with_one_row_and_no_second_provider_query(): void
    {
        $attempt = $this->pendingAttempt('invoice:ev-4', 'idem-ev-0004');
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $body = $this->body('evt_dup', $attempt->provider_payment_id);

        $this->deliver($body)->assertOk()->assertJson(['status' => 'ok']);
        $this->deliver($body)->assertOk()->assertJson(['status' => 'duplicate']);
        $this->deliver($body)->assertOk()->assertJson(['status' => 'duplicate']);

        $this->assertSame(1, PaymentProviderEvent::query()->count());
        $this->assertSame(1, $this->fake->fetchCount);
    }

    #[Test]
    public function the_same_event_id_with_a_different_body_is_a_409_and_changes_nothing(): void
    {
        $attempt = $this->pendingAttempt('invoice:ev-5', 'idem-ev-0005');
        $first = $this->body('evt_same', $attempt->provider_payment_id, 'payment.pending');
        $this->deliver($first)->assertOk();
        $fetches = $this->fake->fetchCount;

        $this->fake->script($attempt->provider_payment_id, 'captured');
        $tampered = $this->body('evt_same', $attempt->provider_payment_id, 'payment.captured');
        $this->deliver($tampered)->assertStatus(409)->assertJson(['status' => 'event_body_conflict']);

        $event = PaymentProviderEvent::query()->firstOrFail();
        $this->assertSame(hash('sha256', $first), $event->body_hash, 'المحفوظ لا يُستبدل');
        $this->assertSame($fetches, $this->fake->fetchCount, 'ولا استعلام ولا معالجة للمتعارض');
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
    }

    // ═══════════════ الأحداث المتأخرة وخارج الترتيب ═══════════════

    #[Test]
    public function late_and_out_of_order_events_never_regress_the_attempt(): void
    {
        $attempt = $this->pendingAttempt('invoice:ev-6', 'idem-ev-0006');
        $id = $attempt->provider_payment_id;

        $this->fake->script($id, 'authorized');
        $this->deliver($this->body('evt_a', $id, 'payment.authorized'))->assertOk();
        $this->assertSame(PaymentAttempt::STATUS_AUTHORIZED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);

        $this->fake->script($id, 'captured');
        $this->deliver($this->body('evt_c', $id, 'payment.captured'))->assertOk();
        $capturedAt = PaymentAttempt::query()->findOrFail($attempt->id)->captured_at;

        // وصل حدث «pending» أقدم بعد الالتقاط: الحقيقة captured فلا أثر ولا رجوع.
        $this->deliver($this->body('evt_old', $id, 'payment.pending'))->assertOk();

        $final = PaymentAttempt::query()->findOrFail($attempt->id);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, $final->capture_status);
        $this->assertEquals($capturedAt, $final->captured_at);
        $this->assertFalse($final->requiresReview());
        $this->assertSame(['applied', 'applied', 'duplicate'], PaymentProviderEvent::query()->orderBy('received_at')->pluck('outcome')->all());
    }

    #[Test]
    public function an_event_for_an_unknown_payment_is_kept_as_unmatched(): void
    {
        $this->deliver($this->body('evt_unk', 'fake_nobody'))->assertOk()->assertJson(['status' => 'unmatched']);

        $event = PaymentProviderEvent::query()->firstOrFail();
        $this->assertSame(PaymentProviderEvent::STATUS_UNMATCHED, $event->status);
        $this->assertNull($event->payment_attempt_id);
        $this->assertSame(0, $this->fake->fetchCount);
    }

    #[Test]
    public function a_provider_outage_leaves_the_event_received_and_the_provider_retry_completes_it_once(): void
    {
        $attempt = $this->pendingAttempt('invoice:ev-7', 'idem-ev-0007');
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $body = $this->body('evt_retry', $attempt->provider_payment_id);

        $this->fake->failFetchWith(new \RuntimeException('provider down'));
        $this->deliver($body)->assertStatus(503)->assertJson(['status' => 'provider_unavailable']);
        $this->assertSame(PaymentProviderEvent::STATUS_RECEIVED, PaymentProviderEvent::query()->firstOrFail()->status);
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);

        $this->fake->failFetchWith(null);
        $this->deliver($body)->assertOk()->assertJson(['status' => 'ok']);

        $this->assertSame(1, PaymentProviderEvent::query()->count());
        $this->assertSame(PaymentProviderEvent::STATUS_PROCESSED, PaymentProviderEvent::query()->firstOrFail()->status);
        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
    }

    // ═══════════════ الأسرار والعزل والضابط ═══════════════

    #[Test]
    public function the_previous_webhook_secret_is_accepted_only_during_its_grace_window(): void
    {
        app(PaymentGatewayService::class)->rotateCredentials($this->gateway->fresh(), ['webhook_secret' => 'whsec_new_value'], 30, $this->owner);
        $body = $this->body('evt_old_secret', 'fake_nobody');

        $this->deliver($body, signature: FakePaymentGatewayAdapter::sign($body, self::SECRET))->assertOk();
        $this->deliver($this->body('evt_new_secret', 'fake_nobody'), secret: 'whsec_new_value')->assertOk();

        DB::table('payment_gateways')->where('id', $this->gateway->id)->update(['previous_secret_expires_at' => now()->subMinute()]);
        $expired = $this->body('evt_after_grace', 'fake_nobody');
        $this->deliver($expired, signature: FakePaymentGatewayAdapter::sign($expired, self::SECRET))->assertUnauthorized();
    }

    #[Test]
    public function an_event_on_one_tenants_connection_can_never_touch_another_tenants_attempt(): void
    {
        $other = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'pay-h1-04-b', 'vat_number' => '300000000000014', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $otherGateway = $this->activeGateway('Other');
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $other->id, true, 'تفعيل الشركة الأخرى');
        $victim = $this->orchestrator->start(new TestPayable(key: 'invoice:victim'), $otherGateway, 'idem-ev-victim');
        $this->fake->script($victim->provider_payment_id, 'captured');
        app(TenantContext::class)->set($this->tenant->id);

        // مفتاح اتصال المستأجر الأول وجسم يشير إلى دفعة المستأجر الآخر.
        $this->deliver($this->body('evt_cross', $victim->provider_payment_id))->assertOk()->assertJson(['status' => 'unmatched']);

        app(TenantContext::class)->set($other->id);
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->findOrFail($victim->id)->capture_status);
        $this->assertSame(0, PaymentProviderEvent::query()->count(), 'لا يظهر حدث المستأجر الأول للآخر');
    }

    #[Test]
    public function the_platform_emergency_stop_does_not_block_receiving_events_for_existing_attempts(): void
    {
        $attempt = $this->pendingAttempt('invoice:ev-8', 'idem-ev-0008');
        app(PaymentsRolloutControlService::class)->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');
        $this->fake->script($attempt->provider_payment_id, 'captured');

        $this->deliver($this->body('evt_stop', $attempt->provider_payment_id))->assertOk();

        $this->assertSame(PaymentAttempt::STATUS_CAPTURED, PaymentAttempt::query()->findOrFail($attempt->id)->capture_status);
    }

    #[Test]
    public function the_route_is_public_throttled_and_never_passes_through_tenant_middleware(): void
    {
        $route = collect(\Illuminate\Support\Facades\Route::getRoutes()->getRoutes())->first(fn ($r) => str_contains($r->uri(), 'payment-webhooks'));
        $this->assertNotNull($route);
        $middleware = array_map('strval', $route->gatherMiddleware());
        $this->assertContains('throttle:600,1', $middleware);
        $this->assertNotContains(\App\Http\Middleware\SetTenant::class, $middleware);
        $this->assertEmpty(array_filter($middleware, fn ($m) => str_starts_with($m, 'auth')));
    }

    #[Test]
    public function the_event_model_refuses_rewrites_and_deletes(): void
    {
        $this->deliver($this->body('evt_guard', 'fake_nobody'))->assertOk();
        $event = PaymentProviderEvent::query()->firstOrFail();

        foreach (['provider_event_id' => 'x', 'body_hash' => str_repeat('0', 64), 'tenant_id' => (string) \Illuminate\Support\Str::uuid(), 'body' => 'rewritten'] as $field => $value) {
            $this->thrown(fn () => $event->fresh()->forceFill([$field => $value])->save(), $field, LogicException::class);
        }
        $this->thrown(fn () => $event->fresh()->delete(), 'delete', LogicException::class);
        $this->assertTrue($event->fresh()->forceFill(['body' => null])->save(), 'القصّ بالاحتفاظ مسموح');
    }

    // ═══════════════ المطابقة اليدوية ═══════════════

    #[Test]
    public function the_manual_sync_endpoint_recovers_a_stuck_attempt_with_rbac_and_tenant_isolation(): void
    {
        $registered = $this->registerTenant('pay-h1-04-api', 'owner@pay-h1-04-api.test');
        app(TenantContext::class)->set($registered['tenant_id']);
        $gateway = $this->activeGateway('Api');
        app(PaymentsRolloutControlService::class)->setTenantState($this->admin, $registered['tenant_id'], true, 'تفعيل');
        $attempt = $this->orchestrator->start(new TestPayable(key: 'invoice:manual'), $gateway, 'idem-ev-manual');
        $this->fake->script($attempt->provider_payment_id, 'captured');
        $staff = $this->tokenForRole($registered['tenant_id'], 'staff', 'staff@pay-h1-04-api.test');
        $url = "/api/payment-attempts/{$attempt->id}/sync";

        $this->flushHeaders();
        $this->postJson($url)->assertUnauthorized();
        $this->withToken($staff)->postJson($url)->assertForbidden();

        $foreign = $this->registerTenant('pay-h1-04-x', 'owner@pay-h1-04-x.test');
        $this->withToken($foreign['token'])->postJson($url)->assertNotFound();
        $this->assertSame(PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::query()->withoutGlobalScopes()->findOrFail($attempt->id)->capture_status);

        $this->withToken($registered['token'])->postJson($url)->assertOk()
            ->assertJsonPath('data.capture_status', 'captured')->assertJsonPath('data.applied', true);
        $this->withToken($registered['token'])->postJson($url)->assertOk()->assertJsonPath('data.applied', false)->assertJsonPath('data.ignored_reason', 'duplicate');

        app(TenantContext::class)->set($registered['tenant_id']);
        $this->fake->failFetchWith(new \RuntimeException('down'));
        $second = $this->orchestrator->start(new TestPayable(key: 'invoice:manual-2'), $gateway, 'idem-ev-manual-2');
        $this->withToken($registered['token'])->postJson("/api/payment-attempts/{$second->id}/sync")->assertStatus(503);
    }

    #[Test]
    public function the_inbox_never_touches_the_ledger_or_payment_services(): void
    {
        $forbidden = '/LedgerService|PaymentService|JournalEntry|JournalLine|InvoiceService|ZatcaService|CustomerRefund|PaymentGatewaySettlement|table\([\'"](journal_|payments[\'"]|invoices)/';
        foreach (['app/Services/PaymentWebhookInbox.php', 'app/Services/PaymentAttemptReconciler.php', 'app/Models/PaymentProviderEvent.php', 'app/Http/Controllers/Api/PaymentWebhookController.php', 'app/Http/Controllers/Api/PaymentAttemptController.php'] as $file) {
            $this->assertDoesNotMatchRegularExpression($forbidden, php_strip_whitespace(base_path($file)), $file);
        }
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function activeGateway(string $name = 'Fake'): PaymentGateway
    {
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => $name, 'environment' => 'sandbox', 'webhook_secret' => self::SECRET]);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => PaymentGateway::STATUS_ACTIVE, 'is_active' => true]);

        return $gateway->fresh();
    }

    private function pendingAttempt(string $payableKey, string $idem): PaymentAttempt
    {
        return $this->orchestrator->start(new TestPayable(key: $payableKey), $this->gateway, $idem);
    }

    private function body(string $eventId, string $paymentId, string $type = 'payment.updated'): string
    {
        return (string) json_encode(['id' => $eventId, 'type' => $type, 'payment_id' => $paymentId]);
    }

    private function deliver(string $body, ?string $signature = null, string $secret = self::SECRET): \Illuminate\Testing\TestResponse
    {
        return $this->call(
            'POST',
            "/api/payment-webhooks/fake/{$this->gateway->webhook_key}",
            [], [], [],
            ['HTTP_X_FAKE_SIGNATURE' => $signature ?? FakePaymentGatewayAdapter::sign($body, $secret), 'CONTENT_TYPE' => 'application/json'],
            $body,
        );
    }

    private function assertNoFinancialArtifacts(): void
    {
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
    }
}
