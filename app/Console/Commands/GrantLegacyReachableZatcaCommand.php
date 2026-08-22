<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\EntitlementGrantService;
use App\Services\TenantApplicationService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/** Grants the one documented legacy-reachable ZATCA capability after explicit confirmation. */
class GrantLegacyReachableZatcaCommand extends Command
{
    private const CAPABILITY_KEY = 'compliance.zatca';

    private const DOCUMENTED_TENANT_ID = 'a278e3a7-8eec-4ba7-a32b-7e433541042d';

    protected $signature = 'entitlements:grant-legacy-reachable-zatca
        {--tenant= : Legacy tenant UUID to receive compliance.zatca only}
        {--apply : Confirm the single documented entitlement grant}';

    protected $description = 'Grant compliance.zatca for one confirmed legacy-reachable tenant through EntitlementGrantService.';

    public function __construct(
        private EntitlementGrantService $grants,
        private TenantApplicationService $applications,
        private TenantContext $tenantContext,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $tenantId = $this->option('tenant');
        if (! is_string($tenantId) || $tenantId === '') {
            $this->error('يتطلب الأمر --tenant=<uuid> صراحة. لم يتغير شيء.');

            return self::FAILURE;
        }

        if (! $this->option('apply')) {
            $this->error('يتطلب الأمر --apply صراحة. لم يتغير شيء.');

            return self::FAILURE;
        }

        if ($tenantId !== self::DOCUMENTED_TENANT_ID) {
            $this->error('هذا الأمر مقيد بالمستأجر الموثق فقط. لم يتغير شيء.');

            return self::FAILURE;
        }

        $tenant = Tenant::query()->whereKey($tenantId)->first();
        if ($tenant === null) {
            $this->error('المستأجر غير موجود. لم يتغير شيء.');

            return self::FAILURE;
        }

        if (! $this->applications->isLegacyTenant($tenant)) {
            $this->error('المنحة الموثقة مخصصة لمستأجر legacy فقط. لم يتغير شيء.');

            return self::FAILURE;
        }

        $previousTenantId = $this->tenantContext->id();
        $this->tenantContext->set($tenant->id);

        try {
            $grant = $this->grants->grant(
                $tenant,
                self::CAPABILITY_KEY,
                EntitlementAccessMode::FULL,
                EntitlementSourceType::LEGACY_GRANDFATHER,
                $tenant->created_at,
                null,
                'legacy-backfill',
                $tenant->id,
                null,
                'LEGACY_REACHABLE',
                'LEGACY_REACHABLE',
                null,
                [
                    'evidence' => 'ENTITLEMENT_SHADOW_MISMATCH',
                    'legacy_reachable' => true,
                ],
            );
        } finally {
            if ($previousTenantId === null) {
                $this->tenantContext->forget();
            } else {
                $this->tenantContext->set($previousTenantId);
            }
        }

        $this->line(sprintf(
            '%s %s for %s',
            $grant->wasRecentlyCreated ? 'GRANTED' : 'ALREADY_GRANTED',
            self::CAPABILITY_KEY,
            $tenant->id,
        ));

        return self::SUCCESS;
    }
}
