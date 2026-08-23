<?php

namespace App\Console\Commands;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProductVersion;
use App\Models\Tenant;
use App\Services\CommercialAssignmentService;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;

class CommercialAssignmentDryRunCommand extends Command
{
    protected $signature = 'entitlements:commercial-assignment-dry-run
        {--tenant= : Tenant UUID (required)}
        {--plan-version= : Commercial plan version UUID}
        {--addon-version= : Commercial product version UUID}
        {--starts-at= : ISO-8601 start timestamp; defaults to now UTC}
        {--ends-at= : Optional ISO-8601 end timestamp}
        {--reason= : Optional recorded reason when applying}
        {--apply : Apply through CommercialAssignmentService; default is read-only}';

    protected $description = 'Preview or explicitly apply one commercial plan/add-on assignment for one tenant.';

    public function handle(CommercialAssignmentService $assignments): int
    {
        $tenantId = $this->option('tenant');
        $planVersionId = $this->option('plan-version');
        $addonVersionId = $this->option('addon-version');
        if (! is_string($tenantId) || ! $this->isUuid($tenantId)) {
            $this->error('The --tenant option must be a UUID.');

            return self::INVALID;
        }
        if ((bool) $planVersionId === (bool) $addonVersionId) {
            $this->error('Supply exactly one of --plan-version or --addon-version.');

            return self::INVALID;
        }
        $versionId = $planVersionId ?: $addonVersionId;
        if (! is_string($versionId) || ! $this->isUuid($versionId)) {
            $this->error('The commercial version option must be a UUID.');

            return self::INVALID;
        }

        $tenant = Tenant::query()->find($tenantId);
        if ($tenant === null) {
            $this->error('Tenant not found.');

            return self::FAILURE;
        }

        try {
            $startsAt = $this->option('starts-at') === null
                ? now('UTC')
                : CarbonImmutable::parse($this->option('starts-at'), 'UTC');
            $endsAt = $this->option('ends-at') === null
                ? null
                : CarbonImmutable::parse($this->option('ends-at'), 'UTC');
            if ($planVersionId) {
                $version = CommercialPlanVersion::query()->findOrFail($versionId);
                $preview = $assignments->previewPlan($tenant, $version, $startsAt, $endsAt);
            } else {
                $version = CommercialProductVersion::query()->findOrFail($versionId);
                $preview = $assignments->previewAddon($tenant, $version, $startsAt, $endsAt);
            }
        } catch (ValidationException $exception) {
            $this->components->error(collect($exception->errors())->flatten()->join(' '));

            return self::INVALID;
        }

        $this->line(json_encode([
            'mode' => $this->option('apply') ? 'apply' : 'dry-run',
            'current_commercial_sources' => $preview['existing_grants'],
            'target_version' => ['source_type' => $preview['source_type'], 'version_id' => $preview['target_version_id']],
            'products' => $preview['products'],
            'capabilities' => $preview['capabilities'],
            'existing_grants' => $preview['existing_grants'],
            'grants_to_create' => $preview['grants_to_create'],
            'conflicts' => $preview['conflicts'],
            'resulting_effective_access' => $preview['resulting_effective_access'],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        if (! $this->option('apply')) {
            $this->info('Read-only dry run complete; no assignment or entitlement grant was written.');

            return self::SUCCESS;
        }

        if ($preview['conflicts'] !== []) {
            $this->error('Apply refused because the assignment preview has conflicts.');

            return self::FAILURE;
        }

        $assignment = $planVersionId
            ? $assignments->assignPlan($tenant, null, $version, $startsAt, $endsAt, $this->option('reason'))
            : $assignments->assignAddon($tenant, null, $version, $startsAt, $endsAt, $this->option('reason'));
        $this->info("Assignment {$assignment->id} applied through CommercialAssignmentService.");

        return self::SUCCESS;
    }

    private function isUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
