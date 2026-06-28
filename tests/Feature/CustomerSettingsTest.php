<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات إعدادات العميل (GET/PUT /api/customer-settings).
 * تفضيلات غير محاسبية — لا قيود. تشغيل: php artisan test --filter=CustomerSettingsTest
 */
class CustomerSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_returns_defaults_when_unset(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->getJson('/api/customer-settings')
            ->assertOk()
            ->assertJsonPath('data.default_type', 'customer')
            ->assertJsonPath('data.payment_terms_days', 30);
    }

    /** @test */
    public function owner_can_update_and_changes_persist(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->putJson('/api/customer-settings', [
            'default_type'       => 'both',
            'default_city'       => 'الدمام',
            'payment_terms_days' => 60,
            'require_tax_number' => true,
            'loyalty_enabled'    => true,
        ])->assertOk()->assertJsonPath('data.default_city', 'الدمام');

        $this->withToken($token)->getJson('/api/customer-settings')
            ->assertOk()
            ->assertJsonPath('data.default_type', 'both')
            ->assertJsonPath('data.payment_terms_days', 60)
            ->assertJsonPath('data.require_tax_number', true);
    }

    /** @test */
    public function staff_cannot_update_customer_settings(): void
    {
        ['tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        $staff = $this->tokenForRole($tid, 'staff', 'staff@nibras.test');

        $this->withToken($staff)->putJson('/api/customer-settings', ['default_city' => 'x'])
            ->assertForbidden();
    }

    /** @test */
    public function settings_are_tenant_isolated(): void
    {
        ['token' => $aToken] = $this->registerTenant('acme', 'owner@acme.test');
        ['token' => $bToken] = $this->registerTenant('globex', 'owner@globex.test');

        $this->withToken($aToken)->putJson('/api/customer-settings', ['default_city' => 'آكمي'])->assertOk();

        $this->withToken($bToken)->getJson('/api/customer-settings')
            ->assertOk()->assertJsonPath('data.default_city', '');
    }
}
