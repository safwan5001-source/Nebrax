<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبار endpoint معلومات الاشتراك.
 * تشغيل:  php artisan test --filter=SubscriptionApiTest
 */
class SubscriptionApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function subscription_endpoint_requires_authentication(): void
    {
        $this->getJson('/api/subscription')->assertUnauthorized();
    }

    /** @test */
    public function it_returns_plan_limits_and_usage(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->getJson('/api/subscription')->assertOk();

        $res->assertJsonPath('plan', 'free')
            ->assertJsonPath('active', true)
            ->assertJsonPath('limits.invoices_per_month', 50)
            ->assertJsonPath('limits.users', 2)
            ->assertJsonPath('usage.invoices_this_month', 0)
            ->assertJsonPath('usage.users', 1);
    }

    /** @test */
    public function usage_reflects_created_invoices(): void
    {
        $auth = $this->registerTenant();

        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])['data']['id'];

        $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->withToken($auth['token'])->getJson('/api/subscription')
            ->assertOk()
            ->assertJsonPath('usage.invoices_this_month', 1);
    }
}
