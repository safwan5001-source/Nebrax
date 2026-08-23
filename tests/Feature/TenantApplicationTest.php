<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CrmActivity;
use App\Models\Employee;
use App\Models\FuelStation;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PosSession;
use App\Models\TenantApplicationEvent;
use App\Services\Accounting\InvoiceService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
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
        $auth = $this->registerTenant(autoEnableApplications: false);

        $res = $this->withToken($auth['token'])->getJson('/api/applications')->assertOk();

        $this->assertCount(43, $res['data']);
        $this->assertTrue($res['data']['sales.invoicing']['enabled']);
        $this->assertTrue($res['data']['accounting.ledger']['enabled']);
        $this->assertFalse($res['data']['hr.employees']['enabled']);
    }

    /** @test */
    public function enabling_a_built_capability_with_satisfied_dependencies_succeeds(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);

        $res = $this->withToken($auth['token'])->postJson('/api/applications/enable', [
            'application_key' => 'sales.pos',
        ])->assertOk();

        $this->assertTrue($res['data']['enabled']);
        $this->assertSame('enabled', TenantApplicationEvent::where('application_key', 'sales.pos')->first()->action);
    }

    /** @test */
    public function enabling_a_coming_soon_capability_is_rejected(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);

        $this->withToken($auth['token'])->postJson('/api/applications/enable', [
            'application_key' => 'accounting.cheques',
        ])->assertStatus(422);
    }

    /** @test */
    public function enabling_an_unknown_key_is_rejected(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);

        $this->withToken($auth['token'])->postJson('/api/applications/enable', [
            'application_key' => 'not.a.real.application',
        ])->assertStatus(422)->assertJsonValidationErrors('application_key');
    }

    /** @test */
    public function disabling_a_mandatory_capability_is_rejected(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'application_key' => 'sales.invoicing',
        ])->assertStatus(422);
    }

    /** @test */
    public function disabling_a_normal_capability_succeeds_after_enabling_it(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertOk();

        $res = $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'application_key' => 'hr.employees',
            'reason' => 'لا حاجة له الآن',
        ])->assertOk();

        $this->assertFalse($res['data']['enabled']);
        $this->assertSame('disabled', $res['data']['status']);
        $this->assertDatabaseHas('tenant_application_events', [
            'tenant_id' => $auth['tenant_id'], 'application_key' => 'hr.employees', 'action' => 'disabled',
        ]);
    }

    /** @test */
    public function disabling_a_capability_with_real_data_suspends_it_for_read_only_access(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertOk();

        Employee::create(['employee_no' => 'EMP-00001', 'name' => 'موظف حقيقي']);

        $res = $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'application_key' => 'hr.employees',
        ])->assertOk();

        $this->assertFalse($res['data']['enabled']);
        $this->assertSame('suspended', $res['data']['status']);
        $this->assertDatabaseHas('tenant_application_events', [
            'tenant_id' => $auth['tenant_id'], 'application_key' => 'hr.employees', 'action' => 'suspended',
        ]);
    }

    /** @test */
    public function a_suspended_capability_can_be_reenabled_normally(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertOk();
        Employee::create(['employee_no' => 'EMP-00001', 'name' => 'موظف حقيقي']);
        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'hr.employees'])
            ->assertOk()->assertJsonPath('data.status', 'suspended');

        $res = $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertOk();

        $this->assertTrue($res['data']['enabled']);
        $this->assertSame('enabled', $res['data']['status']);
    }

    /** @test */
    public function fuel_stations_foundation_suspends_when_a_station_exists(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'fuel_stations.core'])->assertOk();
        FuelStation::create(['code' => 'FS-SUSP-1', 'name' => 'محطة معلقة']);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'fuel_stations.core'])
            ->assertOk()->assertJsonPath('data.status', 'suspended');
    }

    /** @test */
    public function crm_follow_up_suspends_when_activities_exist(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'crm.follow_up'])->assertOk();

        $partner = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        CrmActivity::create(['partner_id' => $partner->id, 'subject' => 'متابعة', 'activity_at' => now()]);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'crm.follow_up'])
            ->assertOk()->assertJsonPath('data.status', 'suspended');
    }

    /** @test */
    public function sales_pos_suspends_when_a_session_exists(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'sales.pos'])->assertOk();

        PosSession::create(['number' => 'POS-TEST-1', 'opened_at' => now()]);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'sales.pos'])
            ->assertOk()->assertJsonPath('data.status', 'suspended');
    }

    /** @test */
    public function finance_operations_suspends_when_a_payment_exists_but_not_from_auto_seeded_cash_bank_accounts(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'finance.operations'])->assertOk();

        // تفعيل طرق الدفع يزرع خزينة وحساباً بنكياً افتراضيين — لا يجب أن
        // يُعلّق finance.operations بمجرد هذا الزرع التلقائي وحده.
        $this->withToken($auth['token'])->getJson('/api/payment-methods')->assertOk();
        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'finance.operations'])
            ->assertOk()->assertJsonPath('data.status', 'disabled');
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'finance.operations'])->assertOk();

        $partner = Partner::create(['name' => 'عميل السند', 'type' => 'customer']);
        Payment::create([
            'number' => 'REC-TEST-1', 'partner_id' => $partner->id, 'direction' => 'received',
            'method' => 'cash', 'status' => 'posted', 'payment_date' => '2026-01-01', 'amount' => 10000,
        ]);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'finance.operations'])
            ->assertOk()->assertJsonPath('data.status', 'suspended');
    }

    /** @test */
    public function company_branches_stays_disableable_with_only_the_auto_provisioned_main_branch(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'company.branches'])->assertOk();

        // الفرع الرئيسي مزروع تلقائياً منذ التسجيل — وحده لا يُعلّق الإيقاف.
        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'company.branches'])
            ->assertOk()->assertJsonPath('data.status', 'disabled');
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'company.branches'])->assertOk();

        Branch::create(['code' => '00002', 'name' => 'فرع ثانٍ', 'is_main' => false]);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'company.branches'])
            ->assertOk()->assertJsonPath('data.status', 'suspended');
    }

    /** @test */
    public function compliance_zatca_never_suspends_since_its_data_lives_on_the_mandatory_invoicing_capability(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->withToken($auth['token'])->postJson('/api/applications/enable', ['application_key' => 'compliance.zatca'])->assertOk();

        $customer = Partner::create(['name' => 'عميل الفاتورة', 'type' => 'customer']);
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
        $posted = app(InvoiceService::class)->post($invoice);
        $this->assertNotNull($posted->zatca_qr);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => 'compliance.zatca'])
            ->assertOk()->assertJsonPath('data.status', 'disabled');
    }

    /** @test */
    public function only_owner_and_admin_can_manage_applications(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: false);
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
        $a = $this->registerTenant('acme', 'owner@acme.test', autoEnableApplications: false);
        $this->withToken($a['token'])->postJson('/api/applications/enable', ['application_key' => 'hr.employees'])->assertOk();

        $b = $this->registerTenant('other', 'owner@other.test', autoEnableApplications: false);
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
        $this->assertCount(43, ApplicationCatalog::all());
    }
}
