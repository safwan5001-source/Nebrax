<?php

namespace Tests\Feature;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Services\CommercialPlanVersionService;
use App\Services\CommercialProductVersionService;
use App\Services\EntitlementGrantService;
use App\Services\TenantApplicationEntitlementResolver;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\TenantApplicationEntitlementDecision;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use LogicException;
use Tests\TestCase;

class EntitlementFoundationTest extends TestCase
{
    use RefreshDatabase;

    private EntitlementGrantService $grants;
    private TenantApplicationEntitlementResolver $resolver;
    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->grants = app(EntitlementGrantService::class);
        $this->resolver = app(TenantApplicationEntitlementResolver::class);
        $this->tenant = Tenant::create(['name' => 'Tenant A', 'slug' => 'tenant-a', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
    }

    /** @test */
    public function commercial_products_and_versions_have_stable_uniqueness_constraints(): void
    {
        $product = CommercialProduct::create(['code' => 'accounting', 'name' => 'Accounting']);
        CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);

        $this->expectException(QueryException::class);
        CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
    }

    /** @test */
    public function product_publication_validates_capabilities_dependency_closure_and_immutability(): void
    {
        $product = CommercialProduct::create(['code' => 'pos', 'name' => 'POS']);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $service = app(CommercialProductVersionService::class);

        foreach ([['not.real'], ['accounting.cheques'], ['sales.pos']] as $invalid) {
            try { $service->setCapabilities($version, $invalid); $this->fail('Invalid composition accepted.'); }
            catch (ValidationException) { $this->addToAssertionCount(1); }
        }

        $service->setCapabilities($version, ['sales.invoicing', 'sales.pos']);
        $this->assertCount(2, $version->capabilities);
        $service->publish($version);
        $this->expectException(LogicException::class);
        $service->setCapabilities($version, ['sales.invoicing']);
    }

    /** @test */
    public function plan_versions_reference_published_product_snapshots_and_are_immutable(): void
    {
        $product = CommercialProduct::create(['code' => 'core', 'name' => 'Core']);
        $productVersion = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);
        $products->setCapabilities($productVersion, ['accounting.ledger']);
        $products->publish($productVersion);
        $plan = CommercialPlanVersion::create(['plan_code' => 'starter', 'version' => 1]);
        $plans = app(CommercialPlanVersionService::class);
        $plans->setProducts($plan, [$productVersion]);
        $plans->publish($plan);

        $this->assertSame($productVersion->id, $plan->products()->first()->commercial_product_version_id);
        $this->expectException(LogicException::class);
        $plans->setProducts($plan, []);
    }

    /** @test */
    public function grants_are_positive_multiple_grouped_and_idempotent(): void
    {
        $at = CarbonImmutable::parse('2026-08-22 12:00:00', 'UTC');
        $group = fake()->uuid();
        $first = $this->grant('sales.invoicing', EntitlementAccessMode::FULL, $at, null, EntitlementSourceType::PLAN, $group);
        $duplicate = $this->grant('sales.invoicing', EntitlementAccessMode::FULL, $at, null, EntitlementSourceType::PLAN, $group);
        $this->grant('sales.invoicing', EntitlementAccessMode::READ_ONLY, $at, null, EntitlementSourceType::MANUAL);

        $this->assertTrue($first->is($duplicate));
        $this->assertSame($group, $first->grant_group_id);
        $this->assertSame(2, TenantApplicationEntitlement::count());
    }

    /** @test */
    public function grant_creation_rejects_unknown_unbuilt_and_invalid_intervals(): void
    {
        $at = CarbonImmutable::parse('2026-08-22', 'UTC');
        foreach (['unknown.key', 'accounting.cheques'] as $key) {
            try { $this->grant($key, EntitlementAccessMode::FULL, $at); $this->fail('Invalid capability accepted.'); }
            catch (ValidationException) { $this->addToAssertionCount(1); }
        }
        $this->expectException(ValidationException::class);
        $this->grant('sales.invoicing', EntitlementAccessMode::FULL, $at, $at);
    }

    /** @test */
    public function resolver_obeys_precedence_half_open_time_and_revocation_boundaries(): void
    {
        $start = CarbonImmutable::parse('2026-08-22 10:00:00', 'UTC');
        $end = $start->addHour();
        $readOnly = $this->grant('sales.invoicing', EntitlementAccessMode::READ_ONLY, $start, $end);

        $this->assertDecision(TenantApplicationEntitlementDecision::DENIED, 'sales.invoicing', $start->subMicrosecond());
        $this->assertDecision(TenantApplicationEntitlementDecision::READ_ONLY, 'sales.invoicing', $start);
        $this->assertDecision(TenantApplicationEntitlementDecision::DENIED, 'sales.invoicing', $end);

        $full = $this->grant('sales.invoicing', EntitlementAccessMode::FULL, $start, $end->addHour(), EntitlementSourceType::ADDON);
        $this->assertDecision(TenantApplicationEntitlementDecision::FULL, 'sales.invoicing', $start->addMinutes(30));
        $full->forceFill(['revoked_at' => $start->addMinutes(40)])->save();
        $this->assertDecision(TenantApplicationEntitlementDecision::FULL, 'sales.invoicing', $start->addMinutes(39));
        $this->assertDecision(TenantApplicationEntitlementDecision::READ_ONLY, 'sales.invoicing', $start->addMinutes(40));
        $this->assertNotNull($readOnly);
    }

    /** @test */
    public function resolver_fail_closes_for_missing_unknown_unbuilt_expired_and_future_grants(): void
    {
        $at = CarbonImmutable::parse('2026-08-22 12:00:00', 'UTC');
        $this->grant('sales.pos', EntitlementAccessMode::FULL, $at->subHours(2), $at->subHour());
        $this->grant('sales.pos', EntitlementAccessMode::FULL, $at->addHour());

        foreach (['sales.pos', 'crm.customers', 'unknown.key', 'accounting.cheques'] as $key) {
            $this->assertDecision(TenantApplicationEntitlementDecision::DENIED, $key, $at);
        }
    }

    /** @test */
    public function resolver_fails_closed_for_an_assignment_scoped_grant_with_a_missing_assignment_relation(): void
    {
        $at = CarbonImmutable::parse('2026-08-22 12:00:00', 'UTC');
        $this->grants->grant(
            $this->tenant,
            'sales.invoicing',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::PLAN,
            $at,
            null,
            'commercial-plan-version',
            '00000000-0000-4000-8000-000000000123',
            '00000000-0000-4000-8000-000000000456',
            'COMMERCIAL_PLAN_VERSION',
            'corrupt assignment reference',
            null,
            ['commercial_assignment_id' => '00000000-0000-4000-8000-000000000456'],
        );

        $this->assertDecision(TenantApplicationEntitlementDecision::DENIED, 'sales.invoicing', $at);
    }

    /** @test */
    public function tenant_scope_prevents_cross_tenant_visibility_and_resolution(): void
    {
        $at = CarbonImmutable::parse('2026-08-22', 'UTC');
        $this->grant('sales.invoicing', EntitlementAccessMode::FULL, $at);
        $tenantB = Tenant::create(['name' => 'Tenant B', 'slug' => 'tenant-b', 'currency' => 'SAR']);

        $this->assertSame(TenantApplicationEntitlementDecision::DENIED, $this->resolver->resolve($tenantB, 'sales.invoicing', $at));
        app(TenantContext::class)->set($tenantB->id);
        $this->assertSame(0, TenantApplicationEntitlement::count());
    }

    private function grant(string $key, EntitlementAccessMode $mode, CarbonImmutable $start, ?CarbonImmutable $end = null, EntitlementSourceType $source = EntitlementSourceType::PLAN, ?string $group = null): TenantApplicationEntitlement
    {
        return $this->grants->grant($this->tenant, $key, $mode, $source, $start, $end, 'test', '00000000-0000-4000-8000-000000000001', $group);
    }

    private function assertDecision(TenantApplicationEntitlementDecision $expected, string $key, CarbonImmutable $at): void
    {
        $this->assertSame($expected, $this->resolver->resolve($this->tenant, $key, $at));
    }
}
