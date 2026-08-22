<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\LegacyEntitlementDryRunService;
use Illuminate\Console\Command;

/** Prints legacy entitlement recommendations only; it never creates or changes grants. */
class LegacyEntitlementDryRunCommand extends Command
{
    protected $signature = 'entitlements:legacy-dry-run
        {--tenant= : Analyze one tenant UUID; otherwise analyze all legacy tenants}
        {--include-no-grant : Include no-evidence rows for review}';

    protected $description = 'Read-only legacy entitlement backfill recommendations; no grants are created.';

    public function __construct(private LegacyEntitlementDryRunService $dryRun)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::query()->whereKey($this->option('tenant'))->get()
            : Tenant::query()->orderBy('name')->get()->filter(
                fn (Tenant $tenant): bool => app(\App\Services\TenantApplicationService::class)->isLegacyTenant($tenant)
            );

        if ($tenants->isEmpty()) {
            $this->warn('لا يوجد مستأجر legacy مطابق للتحليل. لم يتغير شيء.');

            return self::SUCCESS;
        }

        foreach ($tenants as $tenant) {
            $rows = $this->dryRun->recommendFor($tenant);
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

        $this->newLine();
        $this->line('Dry-run فقط: لم يُنشأ أو يُعدّل أي entitlement grant.');

        return self::SUCCESS;
    }
}
