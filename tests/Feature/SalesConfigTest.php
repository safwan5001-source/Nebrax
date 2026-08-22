<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
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
    public function pos_payment_settings_default_to_all_active_methods_and_keep_deferred_sales_enabled(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');
        $methods = $this->withToken($token)->getJson('/api/payment-methods')->assertOk()['data'];
        $cash = collect($methods)->firstWhere('settlement_type', 'cash');
        $bank = collect($methods)->firstWhere('settlement_type', 'bank');

        $this->withToken($token)->getJson('/api/sales-config/pos')
            ->assertOk()
            ->assertJsonPath('data.enabled_payment_method_ids', [])
            ->assertJsonPath('data.default_payment_method_id', null)
            ->assertJsonPath('data.allow_deferred_payment', true);

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => [
                'enabled_payment_method_ids' => [$cash['id'], $bank['id']],
                'default_payment_method_id' => $cash['id'],
                'allow_deferred_payment' => false,
            ],
        ])->assertOk()
            ->assertJsonPath('data.enabled_payment_method_ids.0', $cash['id'])
            ->assertJsonPath('data.default_payment_method_id', $cash['id'])
            ->assertJsonPath('data.allow_deferred_payment', false);

        $this->withToken($token)->getJson('/api/sales-config/pos')
            ->assertOk()
            ->assertJsonPath('data.enabled_payment_method_ids.1', $bank['id'])
            ->assertJsonPath('data.default_payment_method_id', $cash['id'])
            ->assertJsonPath('data.allow_deferred_payment', false);
    }

    /** @test */
    public function pos_category_visibility_defaults_to_all_and_accepts_an_active_tenant_category(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');
        $category = $this->withToken($token)->postJson('/api/product-categories', ['name' => 'قطع غيار'])
            ->assertCreated()['data'];

        $this->withToken($token)->getJson('/api/sales-config/pos')
            ->assertOk()
            ->assertJsonPath('data.product_category_visibility_mode', 'all')
            ->assertJsonPath('data.product_category_ids', []);

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => [
                'product_category_visibility_mode' => 'only',
                'product_category_ids' => [$category['id']],
            ],
        ])->assertOk()
            ->assertJsonPath('data.product_category_visibility_mode', 'only')
            ->assertJsonPath('data.product_category_ids.0', $category['id']);
    }

    /** @test */
    public function pos_category_visibility_rejects_a_disabled_or_foreign_category(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');
        $category = $this->withToken($token)->postJson('/api/product-categories', ['name' => 'مؤقت'])
            ->assertCreated()['data'];
        $this->withToken($token)->putJson("/api/product-categories/{$category['id']}", [
            'name' => 'مؤقت', 'is_active' => false,
        ])->assertOk();

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => ['product_category_visibility_mode' => 'except', 'product_category_ids' => [$category['id']]],
        ])->assertUnprocessable();

        $other = $this->registerTenant('other', 'other@nibras.test');
        $foreign = $this->withToken($other['token'])->postJson('/api/product-categories', ['name' => 'تصنيف آخر'])
            ->assertCreated()['data'];
        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => ['product_category_visibility_mode' => 'only', 'product_category_ids' => [$foreign['id']]],
        ])->assertUnprocessable();
    }

    /** @test */
    public function pos_payment_settings_reject_invalid_or_disabled_default_selection(): void
    {
        ['token' => $token] = $this->registerTenant('nibras', 'owner@nibras.test');
        $methods = $this->withToken($token)->getJson('/api/payment-methods')->assertOk()['data'];
        $cash = collect($methods)->firstWhere('settlement_type', 'cash');
        $bank = collect($methods)->firstWhere('settlement_type', 'bank');

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => [
                'enabled_payment_method_ids' => [$cash['id']],
                'default_payment_method_id' => $bank['id'],
            ],
        ])->assertUnprocessable();

        $this->withToken($token)->putJson('/api/sales-config/pos', [
            'data' => ['enabled_payment_method_ids' => [(string) Str::uuid()]],
        ])->assertUnprocessable();
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
