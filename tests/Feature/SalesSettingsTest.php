<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات إعدادات المبيعات (GET/PUT /api/sales-settings).
 * تفضيلات غير محاسبية — لا قيود. تشغيل: php artisan test --filter=SalesSettingsTest
 */
class SalesSettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_returns_defaults_when_unset(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->getJson('/api/sales-settings')
            ->assertOk()
            ->assertJsonPath('data.default_tax_rate', 15)
            ->assertJsonPath('data.default_payment_type', 'credit')
            ->assertJsonPath('data.quote_validity_days', 14);
    }

    /** @test */
    public function owner_can_update_and_changes_persist(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->putJson('/api/sales-settings', [
            'default_tax_rate'     => 5,
            'default_payment_type' => 'cash',
            'quote_validity_days'  => 30,
            'invoice_prefix'       => 'SAL',
            'default_terms'        => 'الدفع خلال 30 يوماً.',
        ])->assertOk()->assertJsonPath('data.default_tax_rate', 5)
            ->assertJsonPath('data.invoice_prefix', 'SAL');

        // التغييرات محفوظة (قراءة لاحقة تعيدها)
        $this->withToken($token)->getJson('/api/sales-settings')
            ->assertOk()
            ->assertJsonPath('data.default_payment_type', 'cash')
            ->assertJsonPath('data.quote_validity_days', 30)
            ->assertJsonPath('data.default_terms', 'الدفع خلال 30 يوماً.');
    }

    /** @test */
    public function validation_rejects_bad_values(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->putJson('/api/sales-settings', [
            'default_tax_rate'     => 200,
            'default_payment_type' => 'bitcoin',
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['default_tax_rate', 'default_payment_type']);
    }

    /** @test */
    public function staff_cannot_update_sales_settings(): void
    {
        ['tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        $staff = $this->tokenForRole($tid, 'staff', 'staff@nibras.test');

        $this->withToken($staff)->putJson('/api/sales-settings', ['default_tax_rate' => 5])
            ->assertForbidden();
    }

    /** @test */
    public function settings_are_tenant_isolated(): void
    {
        ['token' => $aToken] = $this->registerTenant('acme', 'owner@acme.test');
        ['token' => $bToken] = $this->registerTenant('globex', 'owner@globex.test');

        $this->withToken($aToken)->putJson('/api/sales-settings', ['invoice_prefix' => 'ACME'])->assertOk();

        // المستأجر B يبقى على الافتراضات
        $this->withToken($bToken)->getJson('/api/sales-settings')
            ->assertOk()->assertJsonPath('data.invoice_prefix', 'INV');
    }
}
