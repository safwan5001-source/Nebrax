<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\TenantApplicationState;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;

/**
 * يوصي بمنح legacy التجارية من دون إنشائها. الدليل الوحيد المقبول هو عقد
 * الوصول القائم أو حالة تطبيق صريحة أو دليل التشغيل الموحّد في
 * TenantApplicationService؛ لا تُقرأ feature_flags ولا تُكتب entitlement rows.
 */
final class LegacyEntitlementDryRunService
{
    public const ACCESS_FULL = 'FULL';
    public const NO_GRANT = 'NO_GRANT';

    public const MANDATORY_CAPABILITY = 'MANDATORY_CAPABILITY';
    public const EXPLICIT_APPLICATION_STATE = 'EXPLICIT_APPLICATION_STATE';
    public const OPERATIONAL_DATA_PRESENT = 'OPERATIONAL_DATA_PRESENT';
    public const LEGACY_REACHABLE = 'LEGACY_REACHABLE';
    public const NO_EVIDENCE = 'NO_EVIDENCE';

    public function __construct(
        private TenantApplicationService $applications,
        private TenantContext $tenantContext,
    ) {}

    /**
     * @return list<array{tenant_id:string,capability_key:string,recommended_access_mode:string,reason:string}>
     */
    public function recommendFor(Tenant $tenant): array
    {
        $previousTenantId = $this->tenantContext->id();
        $this->tenantContext->set($tenant->id);

        try {
            $states = TenantApplicationState::query()->get()->keyBy('application_key');
            $recommendations = [];

            foreach (ApplicationCatalog::all() as $key => $capability) {
                if ($capability['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
                    continue;
                }

                [$accessMode, $reason] = $this->recommendationFor($tenant, $key, $capability, $states);
                $recommendations[] = [
                    'tenant_id' => $tenant->id,
                    'capability_key' => $key,
                    'recommended_access_mode' => $accessMode,
                    'reason' => $reason,
                ];
            }

            return $recommendations;
        } finally {
            if ($previousTenantId === null) {
                $this->tenantContext->forget();
            } else {
                $this->tenantContext->set($previousTenantId);
            }
        }
    }

    /**
     * @param array{group:string,maturity:string,mandatory:bool,dependencies:list<string>} $capability
     * @param \Illuminate\Support\Collection<string, TenantApplicationState> $states
     * @return array{string,string}
     */
    private function recommendationFor(Tenant $tenant, string $key, array $capability, $states): array
    {
        if ($capability['mandatory']) {
            return [self::ACCESS_FULL, self::MANDATORY_CAPABILITY];
        }

        $state = $states->get($key);
        if ($state !== null && $state->status === 'enabled') {
            return [self::ACCESS_FULL, self::EXPLICIT_APPLICATION_STATE];
        }

        if ($this->applications->hasOperationalEvidence($key)) {
            return [self::ACCESS_FULL, self::OPERATIONAL_DATA_PRESENT];
        }

        // Grandfathering وحده يجعل built capabilities reachable في الحارس القديم،
        // لكنه ليس دليلاً تجارياً كافياً لمنح كل built capabilities تلقائياً.
        // LEGACY_REACHABLE يبقى سبباً صالحاً عندما تتوفر له إشارة موثقة مستقلة؛
        // أما هذا الأساس الأول فلا يخمّنها.
        return [self::NO_GRANT, self::NO_EVIDENCE];
    }
}
