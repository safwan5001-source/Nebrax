<?php

namespace App\Services;

use App\Models\Tenant;
use App\Support\ApplicationAccessReason;
use App\Support\ApplicationAccessResult;
use App\Support\ApplicationCatalog;
use App\Support\ApplicationOperationClass;
use App\Support\TenantApplicationEntitlementDecision;
use Carbon\CarbonImmutable;
use DateTimeInterface;

/** Computes the entitlement-aware decision. It is deliberately not an enforcement service. */
class ApplicationAccessDecision
{
    public function __construct(
        private TenantApplicationEntitlementResolver $entitlements,
        private TenantApplicationService $applications,
    ) {}

    public function decide(
        Tenant $tenant,
        string $capabilityKey,
        ApplicationOperationClass $operation,
        ?bool $rbacAllowed = null,
        ?DateTimeInterface $evaluationTime = null,
    ): ApplicationAccessResult {
        $memo = [];
        $visiting = [];

        return $this->evaluate(
            $tenant,
            $capabilityKey,
            $operation,
            $rbacAllowed,
            $evaluationTime ?? CarbonImmutable::now('UTC'),
            $memo,
            $visiting,
        );
    }

    /** @param array<string, ApplicationAccessResult> $memo @param array<string, true> $visiting */
    private function evaluate(Tenant $tenant, string $key, ApplicationOperationClass $operation, ?bool $rbacAllowed, DateTimeInterface $at, array &$memo, array &$visiting): ApplicationAccessResult
    {
        $memoKey = $key.'|'.$operation->value;
        if (isset($memo[$memoKey])) return $memo[$memoKey];
        if (isset($visiting[$key])) return ApplicationAccessResult::denied(ApplicationAccessReason::DEPENDENCY_CYCLE);

        $application = $this->catalogEntry($key);
        if ($application === null) return $memo[$memoKey] = ApplicationAccessResult::denied(ApplicationAccessReason::UNKNOWN_CAPABILITY);
        if ($application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) return $memo[$memoKey] = ApplicationAccessResult::denied(ApplicationAccessReason::CAPABILITY_NOT_BUILT);

        $entitlement = $this->entitlements->resolve($tenant, $key, $at);
        if ($entitlement === TenantApplicationEntitlementDecision::DENIED) return $memo[$memoKey] = ApplicationAccessResult::denied(ApplicationAccessReason::NOT_ENTITLED);

        $visiting[$key] = true;
        foreach ($this->dependenciesFor($key) as $dependency) {
            $dependencyResult = $this->evaluate($tenant, $dependency, $operation, null, $at, $memo, $visiting);
            if ($dependencyResult->level->value === 'denied') {
                unset($visiting[$key]);
                $reason = match ($dependencyResult->reason) {
                    ApplicationAccessReason::APPLICATION_DISABLED => ApplicationAccessReason::DEPENDENCY_DISABLED,
                    ApplicationAccessReason::ENTITLEMENT_READ_ONLY => ApplicationAccessReason::DEPENDENCY_READ_ONLY,
                    ApplicationAccessReason::DEPENDENCY_CYCLE => ApplicationAccessReason::DEPENDENCY_CYCLE,
                    default => ApplicationAccessReason::DEPENDENCY_NOT_ENTITLED,
                };
                return $memo[$memoKey] = ApplicationAccessResult::denied($reason);
            }
            if ($dependencyResult->level->value === 'read_only' && ! $operation->permitsReadOnlyAccess()) {
                unset($visiting[$key]);
                return $memo[$memoKey] = ApplicationAccessResult::denied(ApplicationAccessReason::DEPENDENCY_READ_ONLY);
            }
        }
        unset($visiting[$key]);

        $status = $this->applications->statusFor($key);
        if ($status === 'disabled') return $memo[$memoKey] = ApplicationAccessResult::denied(ApplicationAccessReason::APPLICATION_DISABLED);
        if ($status === 'suspended' && ! $operation->permitsReadOnlyAccess()) return $memo[$memoKey] = ApplicationAccessResult::denied(ApplicationAccessReason::APPLICATION_DISABLED);
        if ($rbacAllowed === false) return $memo[$memoKey] = ApplicationAccessResult::denied(ApplicationAccessReason::RBAC_DENIED);
        if ($status === 'suspended') return $memo[$memoKey] = ApplicationAccessResult::readOnly(ApplicationAccessReason::APPLICATION_SUSPENDED_READ_ONLY);
        if ($entitlement === TenantApplicationEntitlementDecision::READ_ONLY) {
            return $memo[$memoKey] = $operation->permitsReadOnlyAccess()
                ? ApplicationAccessResult::readOnly(ApplicationAccessReason::ENTITLEMENT_READ_ONLY)
                : ApplicationAccessResult::denied(ApplicationAccessReason::ENTITLEMENT_READ_ONLY);
        }

        return $memo[$memoKey] = ApplicationAccessResult::allowed();
    }

    /** @return array{group:string,maturity:string,mandatory:bool,dependencies:list<string>}|null */
    protected function catalogEntry(string $key): ?array { return ApplicationCatalog::find($key); }
    /** @return list<string> */
    protected function dependenciesFor(string $key): array { return ApplicationCatalog::dependenciesFor($key); }
}
