<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات طبقة الاشتراكات وتحصين المصادقة:
 * حدود الخطة، انتهاء الاشتراك، تفعيل المستخدم، انتهاء التوكن، throttling.
 * تشغيل:  php artisan test --filter=SubscriptionTest
 */
class SubscriptionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function setTenant(string $tenantId, array $attrs): void
    {
        app(TenantContext::class)->set($tenantId);
        Tenant::find($tenantId)->update($attrs);
    }

    /** @test */
    public function plan_limit_blocks_invoice_creation_beyond_the_monthly_cap(): void
    {
        $auth = $this->registerTenant();
        $this->setTenant($auth['tenant_id'], ['plan_limits' => ['invoices_per_month' => 2]]);

        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])['data']['id'];

        $payload = [
            'partner_id' => $partnerId, 'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ];

        $this->withToken($auth['token'])->postJson('/api/invoices', $payload)->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/invoices', $payload)->assertCreated();
        // الثالثة تتجاوز الحد
        $this->withToken($auth['token'])->postJson('/api/invoices', $payload)
            ->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'حدّ خطتك'));
    }

    /** @test */
    public function expired_subscription_blocks_resource_access(): void
    {
        $auth = $this->registerTenant();
        $this->setTenant($auth['tenant_id'], [
            'trial_ends_at'        => now()->subDay(),
            'subscription_ends_at' => now()->subDay(),
        ]);

        $this->withToken($auth['token'])->getJson('/api/partners')->assertForbidden();
        // لكن /api/me يبقى متاحاً لرؤية الحالة
        $this->withToken($auth['token'])->getJson('/api/me')->assertOk();
    }

    /** @test */
    public function login_is_rejected_for_an_expired_subscription(): void
    {
        $auth = $this->registerTenant('nibras', 'owner@nibras.test');
        $this->setTenant($auth['tenant_id'], [
            'trial_ends_at'        => now()->subDay(),
            'subscription_ends_at' => now()->subDay(),
        ]);

        $this->postJson('/api/login', [
            'slug' => 'nibras', 'email' => 'owner@nibras.test', 'password' => 'password123',
        ])->assertForbidden();
    }

    /** @test */
    public function inactive_user_cannot_login(): void
    {
        $auth = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'موظف',
            'email' => 'staff@nibras.test', 'password' => 'password123',
            'role' => 'staff', 'is_active' => false,
        ]);

        $this->postJson('/api/login', [
            'slug' => 'nibras', 'email' => 'staff@nibras.test', 'password' => 'password123',
        ])->assertForbidden();
    }

    /** @test */
    public function token_expires_after_its_ttl(): void
    {
        $auth = $this->registerTenant();

        // ضمن الصلاحية
        $this->withToken($auth['token'])->getJson('/api/me')->assertOk();

        // بعد انتهاء التوكن (7 أيام)
        $this->travel(8)->days();
        $this->withToken($auth['token'])->getJson('/api/me')->assertUnauthorized();
    }

    /** @test */
    public function login_is_throttled_after_repeated_failures(): void
    {
        $this->registerTenant('nibras', 'owner@nibras.test');

        $attempt = fn () => $this->postJson('/api/login', [
            'slug' => 'nibras', 'email' => 'owner@nibras.test', 'password' => 'wrong',
        ]);

        for ($i = 0; $i < 5; $i++) {
            $attempt()->assertStatus(422); // محاولات فاشلة ضمن الحد
        }
        $attempt()->assertStatus(429); // تجاوز الحد → too many requests
    }
}
