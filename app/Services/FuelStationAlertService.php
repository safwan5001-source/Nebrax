<?php

namespace App\Services;

use App\Models\FinancialControlAlert;
use App\Models\FuelStation;
use App\Models\FuelStationDevice;
use App\Models\FuelStationMaintenanceSchedule;
use App\Models\FuelStationSafetyCorrectiveAction;
use App\Models\FuelStationSafetyPermit;
use App\Models\FuelStationWorkOrder;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * مولد تنبيهات تشغيلية لمحطات الوقود فوق FinancialControlAlert القائم. لا يغير
 * المصدر أو يعالج مشكلةً تشغيلياً؛ يسجلها ويغلقها فقط عند زوالها في فحص صريح.
 */
class FuelStationAlertService
{
    public function __construct(private readonly FuelStationSettingsService $settings)
    {
    }

    /** @return array{detected:int,active:int,resolved:int} */
    public function scan(): array
    {
        $this->requireTenant();
        $issues = [
            ...$this->overdueMaintenanceSchedules(),
            ...$this->overdueWorkOrders(),
            ...$this->overdueCorrectiveActions(),
            ...$this->expiringPermits(),
            ...$this->deviceHealthIssues(),
        ];

        return DB::transaction(function () use ($issues) {
            $fingerprints = [];
            foreach ($issues as $issue) {
                $fingerprints[] = $issue['fingerprint'];
                $this->synchronize($issue);
            }
            $stale = FinancialControlAlert::query()
                ->where('rule', 'like', 'fuel.%')
                ->whereIn('status', ['active', 'acknowledged'])
                ->when($fingerprints !== [], fn ($query) => $query->whereNotIn('fingerprint', $fingerprints))
                ->get();
            foreach ($stale as $alert) {
                $alert->update(['status' => 'resolved', 'resolved_at' => now()]);
            }

            return [
                'detected' => count($issues),
                'active' => FinancialControlAlert::query()->where('rule', 'like', 'fuel.%')->whereIn('status', ['active', 'acknowledged'])->count(),
                'resolved' => $stale->count(),
            ];
        });
    }

    public function acknowledge(FinancialControlAlert $alert, ?string $note, User $actor): FinancialControlAlert
    {
        $this->assertFuelAlert($alert);
        if ($alert->status === 'resolved') {
            throw new RuntimeException('لا يمكن إقرار تنبيه تشغيلي محلول.');
        }
        $before = ['status' => $alert->status, 'acknowledged_by' => $alert->acknowledged_by, 'acknowledged_at' => $alert->acknowledged_at?->toISOString()];
        $alert->update([
            'status' => 'acknowledged', 'acknowledged_by' => $actor->id, 'acknowledged_at' => now(),
            'acknowledgement_note' => $this->optionalText($note, 1000),
        ]);
        $this->auditAlert($alert->fresh(), 'alert.acknowledged', $before, $actor, $note);

        return $alert->fresh();
    }

    public function assign(FinancialControlAlert $alert, ?string $assigneeId, ?string $reason, User $actor): FinancialControlAlert
    {
        $this->assertFuelAlert($alert);
        $assignee = null;
        if ($assigneeId !== null && $assigneeId !== '') {
            $assignee = User::query()->findOrFail($assigneeId);
            if ($assignee->tenant_id !== $alert->tenant_id) throw new RuntimeException('المكلّف لا ينتمي إلى المستأجر النشط.');
        }
        $before = ['assigned_to' => $alert->assigned_to, 'assignment_reason' => $alert->assignment_reason];
        $alert->update(['assigned_to' => $assignee?->id, 'assignment_reason' => $this->optionalText($reason, 500)]);
        $this->auditAlert($alert->fresh(), 'alert.assigned', $before, $actor, $reason);

        return $alert->fresh();
    }

    /** @return list<array<string,mixed>> */
    private function overdueMaintenanceSchedules(): array
    {
        return FuelStationMaintenanceSchedule::query()
            ->where('status', FuelStationMaintenanceSchedule::STATUS_ACTIVE)
            ->whereNotNull('next_due_at')
            ->where('next_due_at', '<=', now())
            ->with('station')
            ->get()
            ->filter(fn (FuelStationMaintenanceSchedule $schedule) => (bool) $this->settings->get($schedule->station, 'fuel_station_alerts_enabled') && (bool) $this->settings->get($schedule->station, 'maintenance_overdue_alerts_enabled'))
            ->map(fn (FuelStationMaintenanceSchedule $schedule) => $this->issue(
                'fuel.maintenance.overdue:' . $schedule->id,
                'fuel.maintenance.overdue', 'high', 'صيانة وقائية مستحقة',
                "جدول الصيانة {$schedule->name} تجاوز موعده التشغيلي.", $schedule->station,
                $schedule::class, $schedule->id, ['schedule_id' => $schedule->id, 'asset_type' => $schedule->asset_type, 'asset_id' => $schedule->asset_id, 'next_due_at' => $schedule->next_due_at?->toISOString()]
            ))->all();
    }

    /** @return list<array<string,mixed>> */
    private function overdueWorkOrders(): array
    {
        return FuelStationWorkOrder::query()
            ->whereIn('status', [FuelStationWorkOrder::STATUS_REPORTED, FuelStationWorkOrder::STATUS_TRIAGED, FuelStationWorkOrder::STATUS_SCHEDULED, FuelStationWorkOrder::STATUS_IN_PROGRESS])
            ->whereNotNull('scheduled_at')->where('scheduled_at', '<', now())
            ->with('station')->get()
            ->filter(fn (FuelStationWorkOrder $order) => (bool) $this->settings->get($order->station, 'fuel_station_alerts_enabled') && (bool) $this->settings->get($order->station, 'maintenance_overdue_alerts_enabled'))
            ->map(fn (FuelStationWorkOrder $order) => $this->issue(
                'fuel.maintenance.work_order_overdue:' . $order->id,
                'fuel.maintenance.work_order_overdue', $order->priority === 'critical' ? 'critical' : 'high',
                'أمر صيانة مفتوح متأخر', "أمر الصيانة {$order->number} لم يكتمل في موعده المجدول.", $order->station,
                $order::class, $order->id, ['work_order_id' => $order->id, 'number' => $order->number, 'status' => $order->status, 'scheduled_at' => $order->scheduled_at?->toISOString()]
            ))->all();
    }

    /** @return list<array<string,mixed>> */
    private function overdueCorrectiveActions(): array
    {
        return FuelStationSafetyCorrectiveAction::query()
            ->whereIn('status', [FuelStationSafetyCorrectiveAction::STATUS_OPEN, FuelStationSafetyCorrectiveAction::STATUS_IN_PROGRESS, FuelStationSafetyCorrectiveAction::STATUS_COMPLETED, FuelStationSafetyCorrectiveAction::STATUS_VERIFIED])
            ->whereNotNull('due_date')->whereDate('due_date', '<', Carbon::today())
            ->with('finding.inspection.station')->get()
            ->filter(fn (FuelStationSafetyCorrectiveAction $action) => (bool) $this->settings->get($action->finding->inspection->station, 'fuel_station_alerts_enabled') && (bool) $this->settings->get($action->finding->inspection->station, 'safety_inspection_overdue_alerts_enabled'))
            ->map(function (FuelStationSafetyCorrectiveAction $action): array {
                $station = $action->finding->inspection->station;
                return $this->issue('fuel.safety.corrective_action_overdue:' . $action->id, 'fuel.safety.corrective_action_overdue', 'high', 'إجراء تصحيحي متأخر', "الإجراء التصحيحي {$action->title} تجاوز تاريخ استحقاقه.", $station, $action::class, $action->id, ['corrective_action_id' => $action->id, 'due_date' => $action->due_date?->toDateString(), 'status' => $action->status]);
            })->all();
    }

    /** @return list<array<string,mixed>> */
    private function expiringPermits(): array
    {
        return FuelStationSafetyPermit::query()->where('status', FuelStationSafetyPermit::STATUS_ACTIVE)->whereNotNull('expires_on')->with('station')->get()
            ->filter(function (FuelStationSafetyPermit $permit): bool {
                if (! (bool) $this->settings->get($permit->station, 'fuel_station_alerts_enabled')) return false;
                $days = (int) $this->settings->get($permit->station, 'safety_permit_expiry_warning_days');
                return $permit->expires_on->lte(Carbon::today()->addDays($days));
            })->map(function (FuelStationSafetyPermit $permit): array {
                $severity = $permit->expires_on->lt(Carbon::today()) ? 'critical' : 'medium';
                return $this->issue('fuel.safety.permit_expiring:' . $permit->id, 'fuel.safety.permit_expiring', $severity, 'تصريح أو شهادة يقترب انتهاؤها', "{$permit->permit_type} ({$permit->reference}) يحتاج تجديداً أو مراجعة.", $permit->station, $permit::class, $permit->id, ['permit_id' => $permit->id, 'reference' => $permit->reference, 'expires_on' => $permit->expires_on?->toDateString()]);
            })->all();
    }

    /** @return list<array<string,mixed>> */
    private function deviceHealthIssues(): array
    {
        return FuelStationDevice::query()->with('station')->get()->flatMap(function (FuelStationDevice $device): array {
            $issues = [];
            $station = $device->station;
            if (! (bool) $this->settings->get($station, 'fuel_station_alerts_enabled')) return $issues;
            if ($device->sync_status === FuelStationDevice::SYNC_FAILED || in_array($device->health, [FuelStationDevice::HEALTH_DEGRADED, FuelStationDevice::HEALTH_OFFLINE], true)) {
                $issues[] = $this->issue('fuel.device.sync_failed:' . $device->id, 'fuel.device.sync_failed', 'high', 'مزامنة جهاز محطة الوقود فاشلة', "الجهاز {$device->name} في حالة صحة أو مزامنة متدهورة.", $station, $device::class, $device->id, ['device_id' => $device->id, 'health' => $device->health, 'sync_status' => $device->sync_status, 'last_failure_reason' => $device->last_failure_reason]);
            }
            $offlineAfter = (int) $this->settings->get($station, 'device_offline_after_seconds', $device->device_key);
            if ($device->last_seen_at !== null && $device->last_seen_at->lt(now()->subSeconds($offlineAfter))) {
                $issues[] = $this->issue('fuel.device.stale:' . $device->id, 'fuel.device.stale', 'medium', 'جهاز محطة الوقود متأخر', "الجهاز {$device->name} لم يرسل دليلاً ضمن النافذة المضبوطة.", $station, $device::class, $device->id, ['device_id' => $device->id, 'last_seen_at' => $device->last_seen_at->toISOString(), 'offline_after_seconds' => $offlineAfter]);
            }
            return $issues;
        })->all();
    }

    /** @return array<string,mixed> */
    private function issue(string $fingerprint, string $rule, string $severity, string $title, string $description, FuelStation $station, string $sourceType, string $sourceId, array $details): array
    {
        return compact('fingerprint', 'rule', 'severity', 'title', 'description', 'station', 'sourceType', 'sourceId', 'details');
    }

    /** @param array<string,mixed> $issue */
    private function synchronize(array $issue): FinancialControlAlert
    {
        /** @var FuelStation $station */
        $station = $issue['station'];
        $alert = FinancialControlAlert::firstOrNew(['fingerprint' => $issue['fingerprint']]);
        $new = ! $alert->exists;
        $reopened = ! $new && $alert->status === 'resolved';
        $alert->fill([
            'tenant_id' => $station->tenant_id, 'branch_id' => $station->branch_id,
            'rule' => $issue['rule'], 'severity' => $issue['severity'], 'title' => $issue['title'],
            'description' => $issue['description'], 'source_type' => $issue['sourceType'], 'source_id' => $issue['sourceId'],
            'details' => array_merge($issue['details'], ['fuel_station_id' => $station->id]), 'last_detected_at' => now(),
        ]);
        if ($new || $reopened) {
            $alert->status = 'active';
            $alert->first_detected_at = now();
            $alert->resolved_at = null;
            $alert->acknowledged_by = null;
            $alert->acknowledged_at = null;
            $alert->acknowledgement_note = null;
        }
        $alert->save();
        return $alert;
    }

    private function assertFuelAlert(FinancialControlAlert $alert): void
    {
        $this->requireTenant();
        if ($alert->tenant_id !== app(TenantContext::class)->id() || ! str_starts_with($alert->rule, 'fuel.')) {
            throw new RuntimeException('تنبيه محطة الوقود غير متاح ضمن المستأجر النشط.');
        }
    }

    /** @param array<string,mixed> $before */
    private function auditAlert(FinancialControlAlert $alert, string $event, array $before, User $actor, ?string $reason): void
    {
        $details = is_array($alert->details) ? $alert->details : [];
        $stationId = $details['fuel_station_id'] ?? null;
        $station = $stationId ? FuelStation::query()->find($stationId) : null;
        FuelStationReadinessEvent::create([
            'tenant_id' => $alert->tenant_id, 'branch_id' => $alert->branch_id, 'fuel_station_id' => $station?->id,
            'subject_type' => $alert::class, 'subject_id' => $alert->id, 'event_type' => $event,
            'before' => $before,
            'after' => ['status' => $alert->status, 'assigned_to' => $alert->assigned_to, 'acknowledged_by' => $alert->acknowledged_by],
            'reason' => $this->optionalText($reason, 500), 'performed_by' => $actor->id, 'occurred_at' => now(),
        ]);
    }

    private function requireTenant(): void
    {
        if (! app(TenantContext::class)->has()) throw new RuntimeException('تنبيهات محطات الوقود تتطلب سياق مستأجر موثوقاً.');
    }

    private function optionalText(?string $value, int $max): ?string
    {
        $value = trim((string) $value);
        if ($value === '') return null;
        if (mb_strlen($value) > $max) throw new RuntimeException('سبب إسناد التنبيه يتجاوز الحد المسموح.');
        return $value;
    }
}
