<?php

namespace Tests\Feature;

use App\Models\TenantApplicationEvent;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P1 — التمكين المحروس: قرار كل مستأجر بتفعيل/إيقاف قدرة من ApplicationCatalog.
 * تشغيل:  php artisan test --filter=TenantApplicationTest
 */
class TenantApplicationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function the_index_merges_the_catalogue_with_tenant_defaults(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->getJson('/api/applications')->assertOk();

        $this->assertCount(36, $res['data']);
        $this->assertTrue($res['data']['sales.invoicing']['enabled']);
        $this->assertTrue($res['data']['accounting.ledger']['enabled']);
        $this->assertFalse($res['data']['hr.employees']['enabled']);
    }

    /** @test */
    public function enabling_a_built_capability_with_satisfied_dependencies_succeeds(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->postJson('/api/applications/enable', [
            'application_key' => 'sales.pos',
        ])->assertOk();

        $this->assertTrue($res['data']['enabled']);
        $this->assertSame('enabled', TenantApplicationEvent::where('application_key', 'sales.pos')->first()->action);
    }

    /** @test */
    public function enabling_a_coming_soon_capability_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/applications/enable', [
            'application_key' => 'accounting.cheques',
        ])->assertStatus(422);
    }

    /** @test */
    public function enabling_an_unknown_key_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/applications/enable', [
            'application_key' => 'not.a.real.application',
        ])->assertStatus(422)->assertJsonValidationErrors('application_key');
    }

    /** @test */
    public function disabling_a_mandatory_capability_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'application_key' => 'sales.invoicing',
        ])->assertStatus(422);
    }

    /** @test */
    public function disabling_a_normal_capability_succeeds_after_enabling_it(): void
    {
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertOk();

        $res = $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'application_key' => 'hr.employees',
            'reason' => 'لا حاجة له الآن',
        ])->assertOk();

        $this->assertFalse($res['data']['enabled']);
        $this->assertSame('disabled', TenantApplicationEvent::where('application_key', 'hr.employees')->latest()->first()->action);
    }

    /** @test */
    public function only_owner_and_admin_can_manage_applications(): void
    {
        $auth = $this->registerTenant();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@acme.test');

        $this->withToken($staff)->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertStatus(403);
        $this->withToken($accountant)->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertStatus(403);
        $this->withToken($staff)->getJson('/api/applications')->assertStatus(403);

        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertOk();
    }

    /** @test */
    public function tenant_enablement_is_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($a['token'])->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertOk();

        $b = $this->registerTenant('other', 'owner@other.test');
        $res = $this->withToken($b['token'])->getJson('/api/applications')->assertOk();

        $this->assertFalse($res['data']['hr.employees']['enabled']);
    }

    /**
     * منطق "من يعتمد على X وهو مفعّل الآن" معزول ونقيّ — مختبَر بمدخلات
     * اصطناعية لأن بيانات الكتالوج الحقيقية اليوم لا تنتج مساراً موجباً
     * (كل اعتماديات القدرات غير الإلزامية تنتهي عند قدرة إلزامية، فيُحجب
     * الإيقاف بفحص `mandatory` أولاً قبل الوصول لهذا الفحص).
     *
     * @test
     */
    public function dependents_currently_enabled_is_computed_from_pure_input(): void
    {
        $catalog = [
            'base' => ['dependencies' => []],
            'child' => ['dependencies' => ['base']],
            'unrelated' => ['dependencies' => []],
        ];

        $this->assertSame(
            ['child'],
            TenantApplicationService::dependentsCurrentlyEnabled('base', $catalog, ['base', 'child', 'unrelated']),
        );
        $this->assertSame(
            [],
            TenantApplicationService::dependentsCurrentlyEnabled('base', $catalog, ['base', 'unrelated']),
        );
    }

    /** @test */
    public function the_catalogue_and_service_agree_on_key_count(): void
    {
        $this->assertCount(36, ApplicationCatalog::all());
    }
}
