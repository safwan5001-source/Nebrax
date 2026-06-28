<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات أقسام إعدادات المبيعات (GET/PUT /api/sales-config/{section}).
 * تفضيلات غير محاسبية — لا قيود. تشغيل: php artisan test --filter=SalesConfigTest
 */
class SalesConfigTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function unknown_section_returns_404(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');
        $this->withToken($token)->getJson('/api/sales-config/bogus')->assertNotFound();
    }

    /** @test */
    public function collection_section_defaults_to_empty_and_persists(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->getJson('/api/sales-config/statuses')
            ->assertOk()->assertExactJson(['data' => []]);

        $items = [['name' => 'مرحّلة', 'color' => '#16A34A'], ['name' => 'ملغاة', 'color' => '#DC2626']];
        $this->withToken($token)->putJson('/api/sales-config/statuses', ['data' => $items])
            ->assertOk()->assertJsonPath('data.0.name', 'مرحّلة');

        $this->withToken($token)->getJson('/api/sales-config/statuses')
            ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.1.color', '#DC2626');
    }

    /** @test */
    public function form_section_returns_object_defaults(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');

        $this->withToken($token)->getJson('/api/sales-config/einvoice')
            ->assertOk()->assertJsonPath('data.phase', '1')->assertJsonPath('data.enabled', false);

        $this->withToken($token)->putJson('/api/sales-config/einvoice', ['data' => ['enabled' => true, 'phase' => '2', 'vat_number' => '310000000000003']])
            ->assertOk();
        $this->withToken($token)->getJson('/api/sales-config/einvoice')
            ->assertOk()->assertJsonPath('data.enabled', true)->assertJsonPath('data.phase', '2');
    }

    /** @test */
    public function staff_cannot_update_config(): void
    {
        ['tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        $staff = $this->tokenForRole($tid, 'staff', 'staff@nibras.test');

        $this->withToken($staff)->putJson('/api/sales-config/sources', ['data' => []])->assertForbidden();
    }

    /** @test */
    public function config_is_tenant_isolated(): void
    {
        ['token' => $aToken] = $this->registerTenant('acme', 'owner@acme.test');
        ['token' => $bToken] = $this->registerTenant('globex', 'owner@globex.test');

        $this->withToken($aToken)->putJson('/api/sales-config/sources', ['data' => [['name' => 'متجر آكمي']]])->assertOk();

        $this->withToken($bToken)->getJson('/api/sales-config/sources')
            ->assertOk()->assertExactJson(['data' => []]);
    }
}
