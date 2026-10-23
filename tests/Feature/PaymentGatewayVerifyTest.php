<?php

namespace Tests\Feature;

use App\Models\PaymentConnectionEvent;
use App\Models\PaymentGateway;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H2-01b — التحقق من بيانات اعتماد المزوّد: قراءة آمنة بمحوّله، يضبط `verified_at` عند القبول فقط، يدقَّق، ولا يحرّك مالاً.
 * Mock فقط: لا مفاتيح حقيقية (التحقق الحقيقي معلّق EXT-01).
 */
class PaymentGatewayVerifyTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private const SECRET = 'sk_test_verify_0001';

    private array $auth;

    protected function setUp(): void
    {
        parent::setUp();
        config(['payment_providers.moyasar.retry_sleep_ms' => 0]);
        $this->auth = $this->registerTenant('h2-verify', 'owner@h2-verify.test');
    }

    private function fakeHttp(array $stubs): void
    {
        Http::swap(new HttpFactory());
        Http::fake($stubs);
    }

    private function createMoyasar(array $over = []): string
    {
        return $this->withToken($this->auth['token'])->postJson('/api/payment-gateways', array_merge([
            'provider' => 'moyasar', 'name' => 'Moyasar '.uniqid(), 'environment' => 'sandbox',
            'publishable_key' => 'pk_test_verify_0001', 'secret_key' => self::SECRET, 'webhook_secret' => 'tok_verify',
        ], $over))->assertCreated()->json('data.id');
    }

    private function verify(string $id, ?string $token = null): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token ?? $this->auth['token'])->postJson("/api/payment-gateways/{$id}/verify");
    }

    private function row(string $id): PaymentGateway
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return PaymentGateway::query()->findOrFail($id);
    }

    /** @return list<string> */
    private function eventTypes(string $id): array
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);

        return PaymentConnectionEvent::query()->where('payment_gateway_id', $id)->orderBy('occurred_at')->pluck('event_type')->all();
    }

    #[Test]
    public function an_accepted_probe_sets_verified_at_audits_it_and_unlocks_activation_without_touching_money(): void
    {
        $id = $this->createMoyasar();
        $this->withToken($this->auth['token'])->postJson("/api/payment-gateways/{$id}/activate")
            ->assertUnprocessable()->assertJsonPath('error.code', 'gateway.verification_required');

        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::response(['invoices' => []])]);
        $this->verify($id)->assertOk()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.is_usable', false);

        $this->assertNotNull($this->row($id)->verified_at);
        $this->assertSame(['created', 'verified'], $this->eventTypes($id));
        // قراءة آمنة فقط: GET بمفتاح Basic، لا POST ولا بيانات بطاقة.
        Http::assertSentCount(1);
        Http::assertSent(fn (Request $r) => $r->method() === 'GET' && str_starts_with($r->url(), 'https://api.moyasar.com/v1/invoices')
            && $r->header('Authorization')[0] === 'Basic '.base64_encode(self::SECRET.':'));

        $this->withToken($this->auth['token'])->postJson("/api/payment-gateways/{$id}/activate")->assertOk()->assertJsonPath('data.status', 'active');
        $this->assertSame(0, \App\Models\Payment::query()->count());
        $this->assertSame(0, \App\Models\JournalEntry::query()->count());
    }

    #[Test]
    public function a_rejected_or_unreachable_provider_never_verifies_and_is_audited_by_code_only(): void
    {
        $id = $this->createMoyasar();

        foreach ([[401, 'moyasar.unauthorized'], [403, 'moyasar.unauthorized'], [429, 'moyasar.rate_limited'], [503, 'moyasar.unavailable']] as [$status, $code]) {
            $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::response(['message' => 'detail '.self::SECRET], $status)]);
            $res = $this->verify($id)->assertUnprocessable()->assertJsonPath('error.code', $code);
            $this->assertStringNotContainsString(self::SECRET, $res->getContent());
        }

        $this->assertNull($this->row($id)->verified_at);
        $events = PaymentConnectionEvent::query()->where('payment_gateway_id', $id)->where('event_type', 'verification_failed')->get();
        $this->assertCount(4, $events);
        $this->assertSame(['moyasar.unauthorized', 'moyasar.unauthorized', 'moyasar.rate_limited', 'moyasar.unavailable'], $events->sortBy('occurred_at')->pluck('reason')->values()->all());
        $this->assertStringNotContainsString(self::SECRET, json_encode($events->toArray()));
    }

    #[Test]
    public function a_definitive_authorization_rejection_drops_a_prior_verification_but_a_transient_failure_keeps_it(): void
    {
        $id = $this->createMoyasar();
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::response(['invoices' => []])]);
        $this->verify($id)->assertOk();
        $this->withToken($this->auth['token'])->postJson("/api/payment-gateways/{$id}/activate")->assertOk();

        foreach ([429, 503] as $status) {
            $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::response([], $status)]);
            $this->verify($id)->assertUnprocessable();
            $this->assertNotNull($this->row($id)->verified_at, "transient {$status}");
        }

        // المفتاح أُبطل لدى المزوّد: التحقق يسقط ولا يبقى الاتصال صالحاً لمحاولات جديدة.
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::response([], 401)]);
        $this->verify($id)->assertUnprocessable()->assertJsonPath('error.code', 'moyasar.unauthorized');
        $this->assertNull($this->row($id)->verified_at);
        $event = PaymentConnectionEvent::query()->where('payment_gateway_id', $id)->where('event_type', 'verification_failed')->latest('occurred_at')->first();
        $this->assertSame(['verified_at'], $event->changed_fields);
        $this->assertSame('moyasar.unauthorized', $event->reason);

        // التنسيق مفعَّل للمستأجر كي يكون الرفض سببه التحقق لا الإطلاق.
        app(TenantContext::class)->set($this->auth['tenant_id']);
        \App\Support\SchedulerHeartbeat::record();
        $admin = \App\Models\PlatformAdministrator::create(['name' => 'مشغّل', 'email' => 'ops@h2-verify.test', 'password' => 'platform-password-123']);
        app(\App\Services\PaymentsRolloutControlService::class)->setTenantState($admin, $this->auth['tenant_id'], true, 'تفعيل للاختبار');
        $orchestrator = app(\App\Services\PaymentOrchestrator::class);
        $e = $this->thrown(fn () => $orchestrator->start(new TestPayable(), $this->row($id), 'idem-verify-401'), 'unverified expected', \App\Support\PaymentOrchestrationException::class);
        $this->assertSame('gateway_unverified', $e->reason);
    }

    #[Test]
    public function a_connection_loss_is_a_typed_failure_and_a_row_with_a_live_key_never_reaches_the_network(): void
    {
        $id = $this->createMoyasar();
        $this->fakeHttp(['api.moyasar.com/*' => fn () => throw new \Illuminate\Http\Client\ConnectionException('boom')]);
        $this->verify($id)->assertUnprocessable()->assertJsonPath('error.code', 'moyasar.unavailable');

        // مفتاح live مكتوب خارج الخدمة: السياسة تُقيَّم قبل أي استدعاء.
        \Illuminate\Support\Facades\DB::table('payment_gateways')->where('id', $id)->update(['secret_key' => \Illuminate\Support\Facades\Crypt::encryptString('sk_live_smuggled_0001')]);
        $this->fakeHttp(['*' => Http::response([])]);
        $this->verify($id)->assertUnprocessable()->assertJsonPath('error.code', 'gateway.moyasar_live_key_in_sandbox');
        Http::assertNothingSent();
        $this->assertNull($this->row($id)->verified_at);
    }

    #[Test]
    public function it_needs_manage_permission_and_is_tenant_isolated(): void
    {
        $id = $this->createMoyasar();
        $this->fakeHttp(['*' => Http::response(['invoices' => []])]);

        $accountant = User::create(['tenant_id' => $this->auth['tenant_id'], 'name' => 'محاسب', 'email' => 'acc@h2-verify.test', 'password' => 'password123', 'role' => 'accountant']);
        $token = $accountant->createToken('t')->plainTextToken;
        $this->verify($id, $token)->assertForbidden();
        Http::assertNothingSent();

        $other = $this->registerTenant('h2-verify-other', 'owner@h2-verify-other.test');
        $this->verify($id, $other['token'])->assertNotFound();
        Http::assertNothingSent();
        $this->assertNull($this->row($id)->verified_at);
    }

    #[Test]
    public function custom_unsupported_and_revoked_connections_are_refused_without_a_network_call(): void
    {
        $this->fakeHttp(['*' => Http::response([])]);
        $custom = $this->withToken($this->auth['token'])->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'يدوي'])->assertCreated()->json('data.id');
        $this->verify($custom)->assertUnprocessable()->assertJsonPath('error.code', 'gateway.verification_not_required');

        $stripe = $this->withToken($this->auth['token'])->postJson('/api/payment-gateways', ['provider' => 'stripe', 'name' => 'Stripe', 'secret_key' => 'sk_x'])->assertCreated()->json('data.id');
        $this->verify($stripe)->assertUnprocessable()->assertJsonPath('error.code', 'gateway.verification_unsupported');

        $revoked = $this->createMoyasar();
        $this->withToken($this->auth['token'])->postJson("/api/payment-gateways/{$revoked}/revoke", ['reason' => 'اختبار'])->assertOk();
        $this->verify($revoked)->assertUnprocessable();
        Http::assertNothingSent();
    }

    #[Test]
    public function rotating_the_secret_or_changing_the_publishable_key_or_environment_invalidates_a_prior_verification(): void
    {
        $id = $this->createMoyasar();
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::response(['invoices' => []])]);

        $this->verify($id)->assertOk();
        $this->withToken($this->auth['token'])->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['secret_key' => 'sk_test_verify_0002'])->assertOk();
        $this->assertNull($this->row($id)->verified_at);

        $this->verify($id)->assertOk();
        $this->withToken($this->auth['token'])->putJson("/api/payment-gateways/{$id}", ['publishable_key' => 'pk_test_verify_0002'])->assertOk();
        $this->assertNull($this->row($id)->verified_at);

        // إعادة الحفظ بالقيمة نفسها لا تبطل التحقق.
        $this->verify($id)->assertOk();
        $this->withToken($this->auth['token'])->putJson("/api/payment-gateways/{$id}", ['publishable_key' => 'pk_test_verify_0002'])->assertOk();
        $this->assertNotNull($this->row($id)->verified_at);
    }

    #[Test]
    public function a_rotation_during_the_probe_does_not_stamp_the_new_secret_as_verified(): void
    {
        $id = $this->createMoyasar();
        $rotated = false;
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => function () use ($id, &$rotated) {
            // أثناء استدعاء المزوّد (خارج المعاملة) يُدوَّر السر.
            app(TenantContext::class)->set($this->auth['tenant_id']);
            $gateway = PaymentGateway::query()->findOrFail($id);
            $gateway->forceFill(['secret_key' => 'sk_test_verify_0003', 'credential_version' => $gateway->credential_version + 1])->save();
            $rotated = true;

            return Http::response(['invoices' => []]);
        }]);

        $this->verify($id)->assertUnprocessable()->assertJsonPath('error.code', 'gateway.credentials_changed');

        $this->assertTrue($rotated);
        $this->assertNull($this->row($id)->verified_at);
        $this->assertNotContains('verified', $this->eventTypes($id));
    }

    #[Test]
    public function the_endpoint_is_throttled(): void
    {
        $id = $this->createMoyasar();
        $this->fakeHttp(['api.moyasar.com/v1/invoices*' => Http::response(['invoices' => []])]);

        for ($i = 0; $i < 10; $i++) {
            $this->verify($id)->assertOk();
        }
        $this->verify($id)->assertStatus(429);
    }
}
