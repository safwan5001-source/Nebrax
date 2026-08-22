<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Services\ApplicationAccessDecision;
use App\Services\TenantApplicationEntitlementResolver;
use App\Services\TenantApplicationService;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationAccessReason;
use App\Support\ApplicationOperationClass;
use App\Support\TenantApplicationEntitlementDecision;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class ApplicationAccessDecisionTest extends TestCase
{
    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = new Tenant(['name' => 'Shadow tenant']);
        $this->tenant->id = '00000000-0000-4000-8000-000000000010';
    }

    public static function directDecisionCases(): array
    {
        return [
            'full enabled' => [TenantApplicationEntitlementDecision::FULL, 'enabled', ApplicationOperationClass::WRITE, null, ApplicationAccessLevel::ALLOWED, ApplicationAccessReason::ACCESS_ALLOWED],
            'read-only read' => [TenantApplicationEntitlementDecision::READ_ONLY, 'enabled', ApplicationOperationClass::READ, null, ApplicationAccessLevel::READ_ONLY, ApplicationAccessReason::ENTITLEMENT_READ_ONLY],
            'read-only write' => [TenantApplicationEntitlementDecision::READ_ONLY, 'enabled', ApplicationOperationClass::WRITE, null, ApplicationAccessLevel::DENIED, ApplicationAccessReason::ENTITLEMENT_READ_ONLY],
            'not entitled' => [TenantApplicationEntitlementDecision::DENIED, 'enabled', ApplicationOperationClass::READ, null, ApplicationAccessLevel::DENIED, ApplicationAccessReason::NOT_ENTITLED],
            'disabled' => [TenantApplicationEntitlementDecision::FULL, 'disabled', ApplicationOperationClass::READ, null, ApplicationAccessLevel::DENIED, ApplicationAccessReason::APPLICATION_DISABLED],
            'suspended read' => [TenantApplicationEntitlementDecision::FULL, 'suspended', ApplicationOperationClass::READ, null, ApplicationAccessLevel::READ_ONLY, ApplicationAccessReason::APPLICATION_SUSPENDED_READ_ONLY],
            'suspended write' => [TenantApplicationEntitlementDecision::FULL, 'suspended', ApplicationOperationClass::WRITE, null, ApplicationAccessLevel::DENIED, ApplicationAccessReason::APPLICATION_DISABLED],
            'rbac denied' => [TenantApplicationEntitlementDecision::FULL, 'enabled', ApplicationOperationClass::READ, false, ApplicationAccessLevel::DENIED, ApplicationAccessReason::RBAC_DENIED],
        ];
    }

    #[DataProvider('directDecisionCases')]
    #[Test]
    public function it_composes_direct_capability_decisions($entitlement, $status, $operation, $rbac, $level, $reason): void
    {
        $decision = $this->decision(['accounting.ledger' => $entitlement], ['accounting.ledger' => $status])
            ->decide($this->tenant, 'accounting.ledger', $operation, $rbac, CarbonImmutable::parse('2026-08-22'));

        $this->assertSame($level, $decision->level);
        $this->assertSame($reason, $decision->reason);
    }

    #[Test]
    public function it_rejects_unknown_and_not_built_capabilities_before_commercial_resolution(): void
    {
        $resolver = $this->createMock(TenantApplicationEntitlementResolver::class);
        $resolver->expects($this->never())->method('resolve');
        $applications = $this->createStub(TenantApplicationService::class);
        $service = new ApplicationAccessDecision($resolver, $applications);

        $this->assertSame(ApplicationAccessReason::UNKNOWN_CAPABILITY, $service->decide($this->tenant, 'missing.key', ApplicationOperationClass::READ)->reason);
        $this->assertSame(ApplicationAccessReason::CAPABILITY_NOT_BUILT, $service->decide($this->tenant, 'accounting.cheques', ApplicationOperationClass::READ)->reason);
    }

    #[Test]
    public function it_evaluates_recursive_dependencies_once_and_maps_their_failures(): void
    {
        $counts = [];
        $resolver = $this->createMock(TenantApplicationEntitlementResolver::class);
        $resolver->method('resolve')->willReturnCallback(function ($tenant, $key) use (&$counts) {
            $counts[$key] = ($counts[$key] ?? 0) + 1;
            return $key === 'accounting.ledger' ? TenantApplicationEntitlementDecision::READ_ONLY : TenantApplicationEntitlementDecision::FULL;
        });
        $applications = $this->createStub(TenantApplicationService::class);
        $applications->method('statusFor')->willReturn('enabled');
        $service = new ApplicationAccessDecision($resolver, $applications);

        $result = $service->decide($this->tenant, 'compliance.zatca', ApplicationOperationClass::WRITE);

        $this->assertSame(ApplicationAccessReason::DEPENDENCY_READ_ONLY, $result->reason);
        $this->assertSame(1, $counts['sales.invoicing']);
        $this->assertSame(1, $counts['accounting.ledger']);

        $denied = $this->decision(['sales.pos' => TenantApplicationEntitlementDecision::FULL], ['sales.pos' => 'enabled'])
            ->decide($this->tenant, 'sales.pos', ApplicationOperationClass::READ);
        $this->assertSame(ApplicationAccessReason::DEPENDENCY_NOT_ENTITLED, $denied->reason);

        $disabled = $this->decision(null, ['sales.pos' => 'enabled', 'sales.invoicing' => 'disabled'])
            ->decide($this->tenant, 'sales.pos', ApplicationOperationClass::READ);
        $this->assertSame(ApplicationAccessReason::DEPENDENCY_DISABLED, $disabled->reason);
    }

    #[Test]
    public function it_fails_closed_on_a_defensive_dependency_cycle(): void
    {
        $service = new class($this->resolverFrom(null), $this->applicationsFrom([])) extends ApplicationAccessDecision {
            protected function catalogEntry(string $key): ?array { return ['group' => 'test', 'maturity' => 'built', 'mandatory' => false, 'dependencies' => [$key === 'a' ? 'b' : 'a']]; }
            protected function dependenciesFor(string $key): array { return [$key === 'a' ? 'b' : 'a']; }
        };

        $this->assertSame(ApplicationAccessReason::DEPENDENCY_CYCLE, $service->decide($this->tenant, 'a', ApplicationOperationClass::READ)->reason);
    }

    private function decision(?array $entitlements = null, array $statuses = []): ApplicationAccessDecision
    {
        return new ApplicationAccessDecision($this->resolverFrom($entitlements), $this->applicationsFrom($statuses));
    }

    private function resolverFrom(?array $entitlements): TenantApplicationEntitlementResolver
    {
        $resolver = $this->createStub(TenantApplicationEntitlementResolver::class);
        $resolver->method('resolve')->willReturnCallback(fn ($tenant, $key) => $entitlements[$key] ?? ($entitlements === null ? TenantApplicationEntitlementDecision::FULL : TenantApplicationEntitlementDecision::DENIED));
        return $resolver;
    }

    private function applicationsFrom(array $statuses): TenantApplicationService
    {
        $applications = $this->createStub(TenantApplicationService::class);
        $applications->method('statusFor')->willReturnCallback(fn ($key) => $statuses[$key] ?? 'enabled');
        return $applications;
    }
}
