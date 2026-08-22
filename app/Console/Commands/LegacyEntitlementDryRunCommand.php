<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\EntitlementGrantService;
use App\Services\LegacyEntitlementDryRunService;
use App\Services\TenantApplicationService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * Prints legacy entitlement recommendations by default. Apply mode is deliberately
 * limited to one confirmed legacy tenant and delegates every write to
 * EntitlementGrantService.
 */
class LegacyEntitlementDryRunCommand extends Command
{
    protected $signature = 'entitlements:legacy-dry-run
        {--tenant= : Analyze one tenant UUID; otherwise analyze all legacy tenants}
        {--include-no-grant : Include no-evidence rows for review}
        {--apply : Apply FULL recommendations for exactly one confirmed legacy tenant}';

    protected $description = 'Read-only legacy entitlement recommendations, with explicit single-tenant apply mode.';

    public function __construct(
        private LegacyEntitlementDryRunService $dryRun,
        private EntitlementGrantService $grants,
        private TenantApplicationService $applications,
        private TenantContext $tenantContext,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        if ($this->option('apply')) {
            return $this->applyForTenant();
        }

        $tenants = $this->option('tenant')
            ? Tenant::query()->whereKey($this->option('tenant'))->get()
            : Tenant::query()->orderBy('name')->get()->filter(
                fn (Tenant $tenant): bool => $this->applications->isLegacyTenant($tenant)
            );

        if ($tenants->isEmpty()) {
            $this->warn('لا يوجد مستأجر legacy مطابق للتحليل. لم يتغير شيء.');

            return self::SUCCESS;
        }

        foreach ($tenants as $tenant) {
            $this->displayRows($tenant, $this->dryRun->recommendFor($tenant));
        }

        $this->newLine();
        $this->line('Dry-run فقط: لم يُنشأ أو يُعدّل أي entitlement grant.');

        return self::SUCCESS;
    }

    private function applyForTenant(): int
    {
        $tenantId = $this->option('tenant');
        if (! is_string($tenantId) || $tenantId === '') {
            $this->error('يتطلب --apply تمرير --tenant=<uuid> صراحة. لم يتغير شيء.');

            return self::FAILURE;
        }

        $tenant = Tenant::query()->whereKey($tenantId)->first();
        if ($tenant === null) {
            $this->error('المستأجر غير موجود. لم يتغير شيء.');

            return self::FAILURE;
        }

        if (! $this->applications->isLegacyTenant($tenant)) {
            $this->error('وضع --apply مخصص لمستأجر legacy فقط. لم يتغير شيء.');

            return self::FAILURE;
        }

        $rows = $this->dryRun->recommendFor($tenant);
        $grantRows = array_values(array_filter(
            $rows,
            fn (array $row): bool => $row['recommended_access_mode'] === LegacyEntitlementDryRunService::ACCESS_FULL,
        ));

        $this->newLine();
        $this->line("سيُمنح المستأجر {$tenant->id} بالقدرات التالية فقط:");
        $this->table(
            ['tenant_id', 'capability_key', 'recommended_access_mode', 'reason'],
            $grantRows,
        );

        $previousTenantId = $this->tenantContext->id();
        $this->tenantContext->set($tenant->id);

        try {
            foreach ($grantRows as $row) {
                $capabilityKey = $row['capability_key'];
                $stableReferenceId = "{$tenant->id}:{$capabilityKey}";
                $grant = $this->grants->grant(
                    $tenant,
                    $capabilityKey,
                    EntitlementAccessMode::FULL,
                    EntitlementSourceType::LEGACY_GRANDFATHER,
                    $tenant->created_at,
                    null,
                    'legacy-backfill',
                    $stableReferenceId,
                    "legacy-backfill:{$tenant->id}",
                    'LEGACY_ENTITLEMENT_BACKFILL',
                    'LEGACY_ENTITLEMENT_BACKFILL',
                    null,
                    ['recommendation_reason' => $row['reason']],
                );

                $this->line(sprintf(
                    '%s %s',
                    $grant->wasRecentlyCreated ? 'GRANTED' : 'ALREADY_GRANTED',
                    $capabilityKey,
                ));
            }
        } finally {
            if ($previousTenantId === null) {
                $this->tenantContext->forget();
            } else {
                $this->tenantContext->set($previousTenantId);
            }
        }

        $this->info('Apply مكتمل: مُنحت توصيات FULL فقط عبر EntitlementGrantService. لم تتغير حالة التطبيق أو الخطة أو الاشتراك.');

        return self::SUCCESS;
    }

    /** @param list<array{tenant_id:string,capability_key:string,recommended_access_mode:string,reason:string}> $rows */
    private function displayRows(Tenant $tenant, array $rows): void
    {
        if (! $this->option('include-no-grant')) {
            $rows = array_values(array_filter(
                $rows,
                fn (array $row): bool => $row['recommended_access_mode'] !== LegacyEntitlementDryRunService::NO_GRANT,
            ));
        }

        $this->newLine();
        $this->line("── {$tenant->id} ──");
        $this->table(
            ['tenant_id', 'capability_key', 'recommended_access_mode', 'reason'],
            $rows,
        );
    }
}
