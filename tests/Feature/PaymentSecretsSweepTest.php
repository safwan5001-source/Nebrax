<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H8-01 (R-15): مسح شامل — لا يظهر أي سر اتصال في **أي** مسار GET للمدفوعات (بوابات، محاولات، استردادات، تسويات، تعديلات، تقارير، سجل الأحداث)،
 * ولا في الاستجابات الخاطئة (404/403). يغطي ما أُضيف بعد اختبارات الاتصال الأولى.
 */
class PaymentSecretsSweepTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const SECRETS = ['sk_sweep_SECRET_KEY_VALUE', 'whsec_sweep_SECRET_VALUE', 'acct_sweep_SECRET_VALUE', 'sk_sweep_ROTATED_SECRET'];

    #[Test]
    public function no_payments_read_endpoint_ever_returns_a_connection_secret(): void
    {
        $tenant = $this->registerTenant('sweep-secrets', 'owner@sweep-secrets.test');
        $token = $tenant['token'];
        $created = $this->withToken($token)->postJson('/api/payment-gateways', [
            'provider' => 'custom', 'name' => 'مسح', 'publishable_key' => 'pk_visible',
            'secret_key' => self::SECRETS[0], 'webhook_secret' => self::SECRETS[1], 'extra_credentials' => ['acct' => self::SECRETS[2]],
        ])->assertCreated();
        $gatewayId = $created->json('data.id');
        $this->withToken($token)->postJson("/api/payment-gateways/{$gatewayId}/rotate-credentials", ['secret_key' => self::SECRETS[3], 'grace_minutes' => 30])->assertOk();

        $uuid = '00000000-0000-4000-8000-000000000001';
        $visited = 0;
        foreach (Route::getRoutes()->getRoutes() as $route) {
            $uri = $route->uri();
            if (! in_array('GET', $route->methods(), true) || ! preg_match('#^api/(payment|payments)#', $uri)) {
                continue;
            }
            $path = preg_replace_callback('/\{(\w+)\??\}/', fn ($m) => str_contains(strtolower($m[1]), 'gateway') ? $gatewayId : $uuid, $uri);
            if (str_starts_with($path, 'api/payment-webhooks') || str_contains($path, 'payment-methods')) {
                continue;
            }
            $res = $this->withToken($token)->getJson('/'.$path);
            $this->assertLessThan(500, $res->getStatusCode(), "{$uri} → {$res->getStatusCode()}");
            foreach (self::SECRETS as $secret) {
                $this->assertStringNotContainsString($secret, $res->getContent(), "سرّ ظهر في {$uri}");
            }
            $visited++;
        }

        $this->assertGreaterThan(15, $visited, 'المسح غطّى مسارات المدفوعات الأساسية');
    }
}
