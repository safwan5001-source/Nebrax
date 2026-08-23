<?php

namespace App\Console\Commands;

use App\Models\TenantCommercialAssignment;
use App\Services\CommercialAssignmentLifecycleService;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

class ReconcileCommercialAssignmentLifecycleCommand extends Command
{
    protected $signature = 'entitlements:commercial-lifecycle-reconcile
        {--tenant= : Tenant UUID (required)}
        {--assignment= : Commercial assignment UUID (required)}
        {--at= : ISO-8601 evaluation time; defaults to now UTC}
        {--apply : Apply lifecycle transition; default is read-only}';

    protected $description = 'Preview or explicitly reconcile the lifecycle of one commercial assignment.';

    public function handle(CommercialAssignmentLifecycleService $lifecycle): int
    {
        $tenantId = $this->option('tenant');
        $assignmentId = $this->option('assignment');
        if (! is_string($tenantId) || ! $this->isUuid($tenantId) || ! is_string($assignmentId) || ! $this->isUuid($assignmentId)) {
            $this->error('Both --tenant and --assignment must be UUIDs.');

            return self::INVALID;
        }
        $assignment = TenantCommercialAssignment::query()->where('id', $assignmentId)->where('tenant_id', $tenantId)->first();
        if ($assignment === null) {
            $this->error('Commercial assignment not found for this tenant.');

            return self::FAILURE;
        }

        $at = $this->option('at') === null ? now('UTC') : CarbonImmutable::parse($this->option('at'), 'UTC');
        $before = $lifecycle->accessForGrant($assignment->tenant, $assignment->id, $at);
        $this->line(json_encode([
            'mode' => $this->option('apply') ? 'apply' : 'dry-run',
            'tenant_id' => $tenantId,
            'assignment_id' => $assignment->id,
            'status' => $assignment->status,
            'lifecycle_state' => $assignment->lifecycle_state,
            'evaluation_time' => $at->toIso8601String(),
            'effective_access' => $before?->value,
            'payment_failed_at' => $assignment->payment_failed_at?->toIso8601String(),
            'scheduled_cancellation_at' => $assignment->scheduled_cancellation_at?->toIso8601String(),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        if (! $this->option('apply')) {
            $this->info('Read-only lifecycle preview complete; no assignment or entitlement grant was changed.');

            return self::SUCCESS;
        }

        $after = $lifecycle->reconcile($assignment, null, $at, 'Controlled lifecycle reconcile command');
        $this->info("Assignment {$after->id} reconciled to {$after->lifecycle_state}.");

        return self::SUCCESS;
    }

    private function isUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
