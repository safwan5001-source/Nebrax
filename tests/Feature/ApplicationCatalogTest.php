<?php

namespace Tests\Feature;

use App\Support\ApplicationCatalog;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  كتالوج التطبيقات — عقد نطاق المنتج، لا مفاتيح واجهة عابرة
 * ═══════════════════════════════════════════════════════════════
 *
 * هذا الاختبار يثبت المرحلة الأولى: كل صف اعتمدناه من خريطة نبراكس ولقطة
 * إدارة التطبيقات المرجعية يملك مفتاحاً مستقراً وحالة نضج واعتماديات معلنة.
 *
 * لا يعني وجود المفتاح أن المستأجر يستطيع استعمال القدرة؛ ذلك قرار المرحلة
 * التالية (استحقاق الخطة + حالة المستأجر + الجاهزية).
 */
class ApplicationCatalogTest extends TestCase
{
    /** @test */
    public function the_catalogue_scope_is_explicit_and_stable(): void
    {
        $expectedKeys = [
            'sales.invoicing',
            'sales.pos',
            'sales.commissions',
            'sales.installments',
            'sales.promotions',
            'sales.insurance',
            'compliance.zatca',
            'crm.customers',
            'crm.follow_up',
            'crm.loyalty',
            'crm.memberships',
            'crm.customer_attendance',
            'crm.points_balances',
            'inventory.core',
            'purchases.cycle',
            'accounting.ledger',
            'accounting.cheques',
            'finance.operations',
            'hr.employees',
            'hr.requests',
            'hr.payroll',
            'hr.attendance',
            'hr.organization',
            'operations.work_orders',
            'operations.rentals',
            'operations.leases',
            'operations.bookings',
            'operations.time_tracking',
            'operations.manufacturing',
            'operations.workflow',
            'fuel_stations.core',
            'fuel_stations.inventory',
            'fuel_stations.forecourt',
            'fuel_stations.fleet',
            'fuel_stations.avi',
            'fuel_stations.maintenance',
            'fuel_stations.integrations',
            'logistics.fleet',
            'logistics.shipping',
            'company.branches',
            'communications.sms',
            'commerce.storefront',
            'integration.mudad',
        ];

        $actualKeys = ApplicationCatalog::keys();
        sort($actualKeys);
        sort($expectedKeys);

        $this->assertSame($expectedKeys, $actualKeys);
        $this->assertCount(43, ApplicationCatalog::all());
        $this->assertSame([], ApplicationCatalog::validationErrors());
    }

    /** @test */
    public function only_built_capabilities_are_activatable_before_tenant_gating(): void
    {
        $this->assertTrue(ApplicationCatalog::isActivatable('sales.pos'));
        $this->assertTrue(ApplicationCatalog::isActivatable('compliance.zatca'));
        $this->assertTrue(ApplicationCatalog::isActivatable('fuel_stations.core'));
        $this->assertTrue(ApplicationCatalog::isActivatable('fuel_stations.avi'));
        $this->assertFalse(ApplicationCatalog::isActivatable('accounting.cheques'));
        $this->assertFalse(ApplicationCatalog::isActivatable('fuel_stations.forecourt'));
        $this->assertFalse(ApplicationCatalog::isActivatable('operations.workflow'));
        $this->assertFalse(ApplicationCatalog::isActivatable('not.a.real.application'));
    }

    /** @test */
    public function accounting_and_customer_foundations_are_explicitly_mandatory(): void
    {
        foreach (['sales.invoicing', 'crm.customers', 'accounting.ledger'] as $key) {
            $application = ApplicationCatalog::find($key);

            $this->assertNotNull($application);
            $this->assertTrue($application['mandatory']);
            $this->assertSame(ApplicationCatalog::MATURITY_BUILT, $application['maturity']);
        }
    }

    /** @test */
    public function high_risk_dependencies_are_declared_at_the_catalogue_boundary(): void
    {
        $this->assertSame(['sales.invoicing'], ApplicationCatalog::dependenciesFor('sales.pos'));
        $this->assertSame(['sales.invoicing', 'accounting.ledger'], ApplicationCatalog::dependenciesFor('compliance.zatca'));
        $this->assertSame(['operations.rentals'], ApplicationCatalog::dependenciesFor('operations.leases'));
        $this->assertSame(['hr.employees', 'accounting.ledger'], ApplicationCatalog::dependenciesFor('hr.payroll'));
        $this->assertSame([], ApplicationCatalog::dependenciesFor('integration.mudad'));
    }

    /** @test */
    public function the_catalogue_keeps_internal_apps_and_external_integrations_separate(): void
    {
        $this->assertSame('integrations', ApplicationCatalog::find('integration.mudad')['group']);
        $this->assertSame('settings', ApplicationCatalog::find('communications.sms')['group']);
        $this->assertSame('sales', ApplicationCatalog::find('commerce.storefront')['group']);
        $this->assertContains('integrations', ApplicationCatalog::groups());
    }

    /** @test */
    public function insurance_and_zatca_are_grouped_by_owner_decision_not_by_key_prefix(): void
    {
        $this->assertSame('customers', ApplicationCatalog::find('sales.insurance')['group']);
        $this->assertSame('settings', ApplicationCatalog::find('compliance.zatca')['group']);
    }

    /** @test */
    public function fuel_station_foundation_and_avi_are_activatable_capabilities_in_their_product_family(): void
    {
        $this->assertSame('fuel_stations', ApplicationCatalog::find('fuel_stations.core')['group']);
        $this->assertSame(ApplicationCatalog::MATURITY_BUILT, ApplicationCatalog::find('fuel_stations.core')['maturity']);
        $this->assertSame(ApplicationCatalog::MATURITY_BUILT, ApplicationCatalog::find('fuel_stations.avi')['maturity']);
        $this->assertSame(['fuel_stations.core'], ApplicationCatalog::dependenciesFor('fuel_stations.avi'));
        foreach (['fuel_stations.inventory', 'fuel_stations.forecourt', 'fuel_stations.fleet', 'fuel_stations.maintenance', 'fuel_stations.integrations'] as $key) {
            $this->assertSame(ApplicationCatalog::MATURITY_COMING_SOON, ApplicationCatalog::find($key)['maturity']);
            $this->assertSame(['fuel_stations.core'], ApplicationCatalog::dependenciesFor($key));
        }
    }

    /** @test */
    public function logistics_is_a_distinct_group_matching_the_sidebar_taxonomy(): void
    {
        $this->assertContains('logistics', ApplicationCatalog::groups());
        $this->assertSame('logistics', ApplicationCatalog::find('logistics.fleet')['group']);
        $this->assertSame('logistics', ApplicationCatalog::find('logistics.shipping')['group']);
        $this->assertSame(ApplicationCatalog::MATURITY_COMING_SOON, ApplicationCatalog::find('logistics.fleet')['maturity']);
        $this->assertSame(ApplicationCatalog::MATURITY_COMING_SOON, ApplicationCatalog::find('logistics.shipping')['maturity']);
    }
}
