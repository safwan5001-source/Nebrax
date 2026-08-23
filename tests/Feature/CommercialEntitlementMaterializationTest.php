<?php

namespace Tests\Feature;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantApplicationState;
use App\Services\ApplicationAccessDecision;
use App\Services\CommercialEntitlementMaterializationService;
use App\Services\CommercialPlanVersionService;
use App\Services\CommercialProductVersionService;
use App\Services\EntitlementGrantService;
use App\Services\TenantApplicationEntitlementResolver;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationOperationClass;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\TenantApplicationEntitlementDecision;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class CommercialEntitlementMaterializationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private CarbonImmutable $startsAt;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'Commercial Tenant A',
            'slug' => 'commercial-tenant-a',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->startsAt = CarbonImmutable::parse('2026-08-23 00:00:00', 'UTC');
    }

    #[Test]
    public function product_versions_accept_only_distinct_built_capabilities_and_preserve_stable_identity(): void
    {
        $product = CommercialProduct::create(['code' => 'pos', 'name' => 'POS']);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);

        foreach ([['unknown.capability'], ['accounting.cheques'], ['sales.invoicing', 'sales.invoicing']] as $invalid) {
            try {
                $products->setCapabilities($version, $invalid);
                $this->fail('An invalid product composition was accepted.');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }

        $products->setCapabilities($version, ['sales.invoicing', 'sales.pos']);
        try {
            $product->forceFill(['code' => 'pos-renamed'])->save();
            $this->fail('Commercial product identity mutation was accepted.');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }
    }

    #[Test]
    public function published_versions_are_immutable_and_new_versions_do_not_mutate_history(): void
    {
        $product = CommercialProduct::create(['code' => 'core', 'name' => 'Core']);
        $v1 = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);
        $products->setCapabilities($v1, ['accounting.ledger']);
        $products->publish($v1);

        try {
            $products->setCapabilities($v1, ['hr.employees']);
            $this->fail('Published product version mutation was accepted.');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }

        $v2 = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 2]);
        $products->setCapabilities($v2, ['hr.employees']);
        $products->publish($v2);

        $this->assertSame(['accounting.ledger'], $v1->capabilities()->pluck('capability_key')->all());
        $this->assertSame(['hr.employees'], $v2->capabilities()->pluck('capability_key')->all());
    }

    #[Test]
    public function published_plan_versions_are_immutable_and_retirement_blocks_new_allocations_only(): void
    {
        [$plan, $productVersion] = $this->publishedPlanWithOneProduct('starter', 'hr', ['hr.employees']);
        $plans = app(CommercialPlanVersionService::class);
        $products = app(CommercialProductVersionService::class);
        $materializer = app(CommercialEntitlementMaterializationService::class);

        try {
            $plans->setProducts($plan, []);
            $this->fail('Published plan version mutation was accepted.');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }

        $materializer->materializePlan($this->tenant, $plan, $this->startsAt);
        $plans->retire($plan);
        $this->assertNotNull($plan->fresh()->retired_at);
        try {
            $materializer->materializePlan($this->tenant, $plan->fresh(), $this->startsAt);
            $this->fail('Retired plan was allocated.');
        } catch (ValidationException) {
            $this->addToAssertionCount(1);
        }
        $this->assertSame(
            TenantApplicationEntitlementDecision::FULL,
            app(TenantApplicationEntitlementResolver::class)->resolve($this->tenant, 'hr.employees', $this->startsAt),
        );

        $products->retire($productVersion);
        $this->assertNotNull($productVersion->fresh()->retired_at);
        try {
            $materializer->materializeAddon($this->tenant, $productVersion->fresh(), $this->startsAt);
            $this->fail('Retired product version was allocated.');
        } catch (ValidationException) {
            $this->addToAssertionCount(1);
        }
        $this->assertSame(1, TenantApplicationEntitlement::count());
    }

    #[Test]
    public function plan_materialization_creates_idempotent_full_grants_with_plan_uuid_reference_and_preserves_state(): void
    {
        [$plan] = $this->publishedPlanWithCoreAndPos();
        $this->enableApplications(['accounting.ledger', 'sales.invoicing', 'sales.pos']);
        $statesBefore = TenantApplicationState::query()->orderBy('application_key')->get(['application_key', 'status'])->map->toArray()->all();
        $materializer = app(CommercialEntitlementMaterializationService::class);

        $before = app(ApplicationAccessDecision::class)->decide($this->tenant, 'sales.pos', ApplicationOperationClass::READ, true, $this->startsAt);
        $this->assertSame(ApplicationAccessLevel::DENIED, $before->level);

        $first = $materializer->materializePlan($this->tenant, $plan, $this->startsAt);
        $second = $materializer->materializePlan($this->tenant, $plan, $this->startsAt);

        $this->assertCount(3, $first);
        $this->assertCount(3, $second);
        $this->assertSame(3, TenantApplicationEntitlement::count());
        TenantApplicationEntitlement::query()->get()->each(function (TenantApplicationEntitlement $grant) use ($plan): void {
            $this->assertSame(EntitlementSourceType::PLAN->value, $grant->source_type);
            $this->assertSame('commercial-plan-version', $grant->source_reference_type);
            $this->assertSame($plan->id, $grant->source_reference_id);
            $this->assertSame($plan->id, $grant->grant_group_id);
            $this->assertSame(EntitlementAccessMode::FULL->value, $grant->access_mode);
        });
        $this->assertSame($statesBefore, TenantApplicationState::query()->orderBy('application_key')->get(['application_key', 'status'])->map->toArray()->all());

        $after = app(ApplicationAccessDecision::class)->decide($this->tenant, 'sales.pos', ApplicationOperationClass::READ, true, $this->startsAt);
        $this->assertSame(ApplicationAccessLevel::ALLOWED, $after->level);
    }

    #[Test]
    public function addon_materialization_uses_product_version_uuid_is_idempotent_and_isolated_by_tenant(): void
    {
        $productVersion = $this->publishedProductVersion('hr', 'HR', ['hr.employees']);
        $materializer = app(CommercialEntitlementMaterializationService::class);

        $materializer->materializeAddon($this->tenant, $productVersion, $this->startsAt);
        $materializer->materializeAddon($this->tenant, $productVersion, $this->startsAt);
        $grant = TenantApplicationEntitlement::sole();
        $this->assertSame(EntitlementSourceType::ADDON->value, $grant->source_type);
        $this->assertSame('commercial-product-version', $grant->source_reference_type);
        $this->assertSame($productVersion->id, $grant->source_reference_id);
        $this->assertSame($productVersion->id, $grant->grant_group_id);

        $tenantB = Tenant::create([
            'name' => 'Commercial Tenant B',
            'slug' => 'commercial-tenant-b',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenantB->id);
        $this->assertSame(0, TenantApplicationEntitlement::count());

        try {
            $materializer->materializeAddon($this->tenant, $productVersion, $this->startsAt);
            $this->fail('A commercial grant crossed the active tenant context.');
        } catch (ValidationException) {
            $this->addToAssertionCount(1);
        }
    }

    #[Test]
    public function legacy_grants_remain_valid_when_commercial_grants_are_materialized(): void
    {
        $legacy = app(EntitlementGrantService::class)->grant(
            $this->tenant,
            'sales.invoicing',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::LEGACY_GRANDFATHER,
            $this->startsAt,
            null,
            'legacy-backfill',
            $this->tenant->id,
            null,
            'LEGACY_REACHABLE',
        );
        $addon = $this->publishedProductVersion('hr', 'HR', ['hr.employees']);

        app(CommercialEntitlementMaterializationService::class)->materializeAddon($this->tenant, $addon, $this->startsAt);

        $this->assertSame(EntitlementSourceType::LEGACY_GRANDFATHER->value, $legacy->fresh()->source_type);
        $this->assertSame(
            TenantApplicationEntitlementDecision::FULL,
            app(TenantApplicationEntitlementResolver::class)->resolve($this->tenant, 'sales.invoicing', $this->startsAt),
        );
    }

    /** @return array{CommercialPlanVersion, CommercialProductVersion} */
    private function publishedPlanWithOneProduct(string $planCode, string $productCode, array $capabilityKeys): array
    {
        $productVersion = $this->publishedProductVersion($productCode, strtoupper($productCode), $capabilityKeys);
        $plan = CommercialPlanVersion::create(['plan_code' => $planCode, 'version' => 1]);
        $plans = app(CommercialPlanVersionService::class);
        $plans->setProducts($plan, [$productVersion]);

        return [$plans->publish($plan), $productVersion];
    }

    /** @return array{CommercialPlanVersion, CommercialProductVersion, CommercialProductVersion} */
    private function publishedPlanWithCoreAndPos(): array
    {
        $core = $this->publishedProductVersion('core', 'Core', ['accounting.ledger']);
        $pos = $this->publishedProductVersion('pos', 'POS', ['sales.invoicing', 'sales.pos']);
        $plan = CommercialPlanVersion::create(['plan_code' => 'starter', 'version' => 1]);
        $plans = app(CommercialPlanVersionService::class);
        $plans->setProducts($plan, [$core, $pos]);

        return [$plans->publish($plan), $core, $pos];
    }

    /** @param list<string> $capabilityKeys */
    private function publishedProductVersion(string $code, string $name, array $capabilityKeys): CommercialProductVersion
    {
        $product = CommercialProduct::create(['code' => $code, 'name' => $name]);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $service = app(CommercialProductVersionService::class);
        $service->setCapabilities($version, $capabilityKeys);

        return $service->publish($version);
    }

    /** @param list<string> $keys */
    private function enableApplications(array $keys): void
    {
        foreach ($keys as $key) {
            TenantApplicationState::create([
                'application_key' => $key,
                'requested_enabled' => true,
                'status' => 'enabled',
            ]);
        }
    }
}
