<?php

namespace Tests\Feature;

use App\Models\PaymentAttempt;
use App\Models\PaymentConnectionEvent;
use App\Models\PaymentGateway;
use App\Services\PaymentGatewayService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H8-01b (R-42) — التدوير الطارئ لمفتاح الاستدعاء: مغلق افتراضياً، لمالك المؤسسة وحده، والاتصال موقوف، بسبب مدقَّق؛ يتجاوز حظر المحاولات القابلة للمطابقة
 * ولا يُبقي المفتاح السابق؛ والتدوير العادي يبقى محظوراً.
 */
class PaymentEmergencyRotationTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    /** @return array{0: string, 1: string, 2: string} [ownerToken, gatewayId, tenantId] اتصال custom بمحاولة قابلة للمطابقة */
    private function gatewayWithPendingAttempt(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $id = $this->withToken($auth['token'])->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'طارئ', 'secret_key' => 'sk_leaked_old', 'webhook_secret' => 'whsec_old'])
            ->assertCreated()->json('data.id');
        $this->withToken($auth['token'])->postJson("/api/payment-gateways/{$id}/activate", ['reason' => 'تفعيل للاختبار'])->assertOk();
        app(TenantContext::class)->set($auth['tenant_id']);
        PaymentAttempt::query()->create([
            'payment_gateway_id' => $id, 'provider' => 'custom', 'environment' => 'sandbox', 'payable_key' => 'invoice:em-1',
            'idempotency_key' => 'idem-em-0001', 'amount_minor' => 1000, 'currency' => 'SAR',
        ]);
        $this->assertTrue(PaymentGateway::query()->findOrFail($id)->hasReconcilableAttempts());

        return [$auth['token'], $id, $auth['tenant_id']];
    }

    #[Test]
    public function it_is_closed_by_default_and_the_normal_rotation_stays_blocked(): void
    {
        [$token, $id] = $this->gatewayWithPendingAttempt('em-closed');

        $this->withToken($token)->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['secret_key' => 'sk_new'])
            ->assertStatus(422)->assertJsonPath('error.code', 'gateway.rotation_blocked');
        $this->withToken($token)->postJson("/api/payment-gateways/{$id}/suspend", ['reason' => 'تسرّب مفتاح'])->assertOk();
        $this->withToken($token)->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['secret_key' => 'sk_new', 'emergency' => true, 'reason' => 'تسرّب مفتاح الاستدعاء'])
            ->assertStatus(422)->assertJsonPath('error.code', 'gateway.emergency_rotation_disabled');
        $this->assertSame('sk_leaked_old', app(PaymentGatewayService::class)->providerCredentials(PaymentGateway::query()->findOrFail($id))['secret_key']);
    }

    #[Test]
    public function when_enabled_it_requires_owner_suspension_and_a_reason_then_rotates_without_keeping_the_old_key(): void
    {
        config(['payments.emergency_rotation.enabled' => true]);
        [$token, $id, $tenantId] = $this->gatewayWithPendingAttempt('em-open');
        $rotate = fn (array $extra = []) => $this->withToken($token)->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['secret_key' => 'sk_new_value', 'emergency' => true] + $extra);

        // الاتصال غير موقوف ⇒ مرفوض
        $rotate(['reason' => 'تسرّب مفتاح الاستدعاء'])->assertStatus(422)->assertJsonPath('error.code', 'gateway.emergency_requires_suspension');
        $this->withToken($token)->postJson("/api/payment-gateways/{$id}/suspend", ['reason' => 'تسرّب مفتاح'])->assertOk();

        // سبب قصير/غائب ⇒ مرفوض
        $rotate(['reason' => 'قصير'])->assertStatus(422)->assertJsonPath('error.code', 'gateway.reason_required');
        $rotate()->assertUnprocessable();

        // غير المالك (admin) ⇒ مرفوض
        $adminToken = $this->tokenForRole($tenantId, 'admin', 'admin@em-open.test');
        $this->withToken($adminToken)->postJson("/api/payment-gateways/{$id}/rotate-credentials", ['secret_key' => 'sk_by_admin', 'emergency' => true, 'reason' => 'محاولة من المدير'])
            ->assertStatus(422)->assertJsonPath('error.code', 'gateway.emergency_rotation_forbidden');

        // المالك + موقوف + سبب ⇒ ينجح رغم المحاولة القائمة
        $res = $rotate(['reason' => 'تسرّب مفتاح الاستدعاء في سجل خارجي'])->assertOk();
        $this->assertStringNotContainsString('sk_new_value', $res->getContent());
        $this->assertStringNotContainsString('sk_leaked_old', $res->getContent());
        app(TenantContext::class)->set($tenantId);
        $gateway = PaymentGateway::query()->findOrFail($id);
        $this->assertSame('sk_new_value', app(PaymentGatewayService::class)->providerCredentials($gateway)['secret_key']);
        $this->assertSame(PaymentGateway::STATUS_SUSPENDED, $gateway->status, 'يبقى موقوفاً حتى التحقق والتفعيل');
        $this->assertSame(2, (int) $gateway->credential_version);

        // المحاولة القائمة باقية لم تُمسّ، والمفتاح السابق لم يُحفظ في أي عمود
        $this->assertSame(1, PaymentAttempt::query()->where('payment_gateway_id', $id)->count());
        $this->assertNull($gateway->previous_webhook_secret);
        $event = PaymentConnectionEvent::query()->where('payment_gateway_id', $id)->where('event_type', 'credentials_emergency_rotated')->firstOrFail();
        $this->assertSame('تسرّب مفتاح الاستدعاء في سجل خارجي', $event->reason);
        $this->assertSame(['secret_key'], $event->changed_fields);
        $this->assertSame(2, (int) $event->credential_version);
        $this->assertStringNotContainsString('sk_', json_encode($event->toArray(), JSON_UNESCAPED_UNICODE));
    }
}
