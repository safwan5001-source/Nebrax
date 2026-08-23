<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelStationDevice;
use App\Models\FuelStationMaintenanceSchedule;
use App\Models\FuelStationReadinessEvent;
use App\Models\FuelStationWorkOrder;
use App\Models\FuelTank;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * صيانة محطات الوقود: حقائق تشغيلية مدققة فقط. لا ينشئ هذا المجال مصروفاً أو
 * أصلاً محاسبياً أو قيداً؛ الكلفة المسجلة تقدير/دليل تشغيلي حتى يمر الإنفاق
 * بمستند المصروف الرسمي القائم.
 */
class FuelStationMaintenanceService
{
    /** @var array<class-string, string> */
    private const ASSET_TYPES = [
        FuelStation::class => 'station',
        FuelTank::class => 'tank',
        FuelPump::class => 'pump',
        FuelNozzle::class => 'nozzle',
        FuelStationDevice::class => 'device',
        Asset::class => 'accounting_asset',
    ];

    /** @param array<string,mixed> $data */
    public function createSchedule(array $data, User $actor): FuelStationMaintenanceSchedule
    {
        $station = $this->station((string) $data['fuel_station_id']);
        [$assetType, $assetId] = $this->assetForStation($station, (string) $data['asset_type'], (string) $data['asset_id']);
        $type = $this->enum((string) $data['schedule_type'], FuelStationMaintenanceSchedule::TYPES, 'نوع جدول الصيانة');
        $intervalDays = $this->nullableNonNegativeInteger($data['interval_days'] ?? null, 'فاصل الأيام');
        $intervalMl = $this->nullableNonNegativeInteger($data['interval_milliliters'] ?? null, 'فاصل العداد');
        if ($type === FuelStationMaintenanceSchedule::TYPE_CALENDAR && (!$intervalDays || $intervalDays < 1)) {
            throw new RuntimeException('الصيانة بالتقويم تتطلب فاصل أيام موجباً.');
        }
        if (in_array($type, [FuelStationMaintenanceSchedule::TYPE_RUNTIME, FuelStationMaintenanceSchedule::TYPE_METER], true) && (!$intervalMl || $intervalMl < 1)) {
            throw new RuntimeException('الصيانة المعتمدة على الاستخدام أو العداد تتطلب فاصل قياس موجباً؛ لا تُفبرك جدولة بدون telemetry.');
        }

        return DB::transaction(function () use ($data, $actor, $station, $assetType, $assetId, $type, $intervalDays, $intervalMl) {
            $schedule = FuelStationMaintenanceSchedule::create([
                'tenant_id' => $station->tenant_id,
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'asset_type' => $assetType,
                'asset_id' => $assetId,
                'name' => $this->text($data['name'] ?? null, 'اسم جدول الصيانة', 160),
                'schedule_type' => $type,
                'interval_days' => $intervalDays,
                'interval_milliliters' => $intervalMl,
                'manufacturer_interval' => $this->optionalText($data['manufacturer_interval'] ?? null, 160),
                'status' => FuelStationMaintenanceSchedule::STATUS_ACTIVE,
                'next_due_at' => $type === FuelStationMaintenanceSchedule::TYPE_CALENDAR ? now()->addDays($intervalDays) : null,
                'instructions' => $this->optionalText($data['instructions'] ?? null, 4000),
                'created_by' => $actor->id,
            ]);
            $this->audit($station, $schedule, 'maintenance.schedule.created', null, $this->snapshot($schedule), $actor, $data['reason'] ?? null);

            return $schedule;
        });
    }

    /** @param array<string,mixed> $data */
    public function createWorkOrder(array $data, User $actor): FuelStationWorkOrder
    {
        $station = $this->station((string) $data['fuel_station_id']);
        [$assetType, $assetId] = $this->assetForStation($station, (string) $data['asset_type'], (string) $data['asset_id']);
        $type = $this->enum((string) $data['work_type'], FuelStationWorkOrder::TYPES, 'نوع أمر الصيانة');
        $schedule = null;
        if (! empty($data['fuel_station_maintenance_schedule_id'])) {
            $schedule = FuelStationMaintenanceSchedule::query()->where('fuel_station_id', $station->id)->findOrFail($data['fuel_station_maintenance_schedule_id']);
            if ($schedule->asset_type !== $assetType || $schedule->asset_id !== $assetId) {
                throw new RuntimeException('جدول الصيانة لا يطابق الأصل المرجعي لأمر العمل.');
            }
        }
        $assigneeId = $this->tenantUserId($data['assigned_to'] ?? null);

        return DB::transaction(function () use ($data, $actor, $station, $assetType, $assetId, $type, $schedule, $assigneeId) {
            $order = FuelStationWorkOrder::create([
                'tenant_id' => $station->tenant_id,
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'fuel_station_maintenance_schedule_id' => $schedule?->id,
                'number' => FuelStationWorkOrder::nextNumber(now()->toDateString(), $station->branch_id),
                'work_type' => $type,
                'status' => FuelStationWorkOrder::STATUS_REPORTED,
                'priority' => $this->enum((string) ($data['priority'] ?? 'medium'), ['low', 'medium', 'high', 'critical'], 'أولوية أمر الصيانة'),
                'severity' => $this->enum((string) ($data['severity'] ?? 'medium'), ['low', 'medium', 'high', 'critical'], 'شدة أمر الصيانة'),
                'asset_type' => $assetType,
                'asset_id' => $assetId,
                'title' => $this->text($data['title'] ?? null, 'عنوان أمر الصيانة', 200),
                'description' => $this->optionalText($data['description'] ?? null, 5000),
                'vendor_name' => $this->optionalText($data['vendor_name'] ?? null, 160),
                'assigned_to' => $assigneeId,
                'cost_minor' => $this->nonNegativeInteger($data['cost_minor'] ?? 0, 'تكلفة الصيانة'),
                'downtime_minutes' => $this->nonNegativeInteger($data['downtime_minutes'] ?? 0, 'مدة التوقف'),
                'evidence_reference' => $this->optionalText($data['evidence_reference'] ?? null, 500),
                'opened_at' => now(),
                'reported_by' => $actor->id,
            ]);
            $this->audit($station, $order, 'maintenance.work_order.reported', null, $this->snapshot($order), $actor, $data['reason'] ?? null);

            return $order;
        });
    }

    /** @param array<string,mixed> $data */
    public function transition(FuelStationWorkOrder $workOrder, string $nextStatus, array $data, User $actor): FuelStationWorkOrder
    {
        $this->assertTenant($workOrder->tenant_id);
        $nextStatus = $this->enum($nextStatus, FuelStationWorkOrder::STATUSES, 'حالة أمر الصيانة');

        return DB::transaction(function () use ($workOrder, $nextStatus, $data, $actor) {
            $workOrder = FuelStationWorkOrder::lockForUpdate()->findOrFail($workOrder->id);
            $this->assertTransition($workOrder->status, $nextStatus, [
                FuelStationWorkOrder::STATUS_REPORTED => [FuelStationWorkOrder::STATUS_TRIAGED],
                FuelStationWorkOrder::STATUS_TRIAGED => [FuelStationWorkOrder::STATUS_SCHEDULED, FuelStationWorkOrder::STATUS_IN_PROGRESS],
                FuelStationWorkOrder::STATUS_SCHEDULED => [FuelStationWorkOrder::STATUS_IN_PROGRESS],
                FuelStationWorkOrder::STATUS_IN_PROGRESS => [FuelStationWorkOrder::STATUS_COMPLETED],
                FuelStationWorkOrder::STATUS_COMPLETED => [FuelStationWorkOrder::STATUS_VERIFIED],
                FuelStationWorkOrder::STATUS_VERIFIED => [FuelStationWorkOrder::STATUS_CLOSED],
                FuelStationWorkOrder::STATUS_CLOSED => [],
            ]);
            $before = $this->snapshot($workOrder);
            $changes = ['status' => $nextStatus];
            if ($nextStatus === FuelStationWorkOrder::STATUS_SCHEDULED) {
                $changes['scheduled_at'] = $this->dateTime($data['scheduled_at'] ?? null, 'موعد الصيانة');
            }
            if ($nextStatus === FuelStationWorkOrder::STATUS_IN_PROGRESS) {
                $changes['started_at'] = now();
            }
            if ($nextStatus === FuelStationWorkOrder::STATUS_COMPLETED) {
                $changes['completed_at'] = now();
                $changes['resolution'] = $this->text($data['resolution'] ?? null, 'حل أمر الصيانة', 5000);
                $changes['root_cause'] = $this->optionalText($data['root_cause'] ?? null, 5000);
                $changes['cost_minor'] = $this->nonNegativeInteger($data['cost_minor'] ?? $workOrder->cost_minor, 'تكلفة الصيانة');
                $changes['downtime_minutes'] = $this->nonNegativeInteger($data['downtime_minutes'] ?? $workOrder->downtime_minutes, 'مدة التوقف');
            }
            if ($nextStatus === FuelStationWorkOrder::STATUS_VERIFIED) {
                $changes['verified_at'] = now();
                $changes['verified_by'] = $actor->id;
            }
            if ($nextStatus === FuelStationWorkOrder::STATUS_CLOSED) {
                $changes['closed_at'] = now();
            }
            $workOrder->update($changes);
            $workOrder->refresh();
            $station = $this->station($workOrder->fuel_station_id);
            $this->audit($station, $workOrder, 'maintenance.work_order.' . $nextStatus, $before, $this->snapshot($workOrder), $actor, $data['reason'] ?? null);

            if ($nextStatus === FuelStationWorkOrder::STATUS_CLOSED && $workOrder->fuel_station_maintenance_schedule_id) {
                $schedule = FuelStationMaintenanceSchedule::lockForUpdate()->find($workOrder->fuel_station_maintenance_schedule_id);
                if ($schedule?->status === FuelStationMaintenanceSchedule::STATUS_ACTIVE) {
                    $schedule->update([
                        'last_completed_at' => $workOrder->closed_at,
                        'next_due_at' => $schedule->schedule_type === FuelStationMaintenanceSchedule::TYPE_CALENDAR
                            ? $workOrder->closed_at->copy()->addDays((int) $schedule->interval_days)
                            : null,
                    ]);
                    $this->audit($station, $schedule, 'maintenance.schedule.completed', null, $this->snapshot($schedule->fresh()), $actor, 'تم تحديث الجدول بعد إغلاق أمر الصيانة.');
                }
            }

            return $workOrder->fresh(['station', 'schedule', 'assignee', 'reporter', 'verifier']);
        });
    }

    /** @return array{class-string,string} */
    public function assetForStation(FuelStation $station, string $type, string $id): array
    {
        if (! array_key_exists($type, self::ASSET_TYPES)) {
            throw new RuntimeException('نوع أصل الصيانة غير معتمد.');
        }
        $model = match ($type) {
            FuelStation::class => FuelStation::query()->whereKey($id)->whereKey($station->id)->firstOrFail(),
            FuelTank::class => FuelTank::query()->where('fuel_station_id', $station->id)->findOrFail($id),
            FuelPump::class => FuelPump::query()->where('fuel_station_id', $station->id)->findOrFail($id),
            FuelNozzle::class => FuelNozzle::query()->where('fuel_station_id', $station->id)->findOrFail($id),
            FuelStationDevice::class => FuelStationDevice::query()->where('fuel_station_id', $station->id)->findOrFail($id),
            Asset::class => Asset::query()->where('branch_id', $station->branch_id)->findOrFail($id),
        };
        if ($model->tenant_id !== $station->tenant_id) {
            throw new RuntimeException('الأصل لا ينتمي إلى مستأجر المحطة.');
        }

        return [$type, $model->id];
    }

    private function station(string $id): FuelStation
    {
        $this->requireTenant();
        $station = FuelStation::query()->findOrFail($id);
        $this->assertTenant($station->tenant_id);

        return $station;
    }

    private function tenantUserId(mixed $id): ?string
    {
        if ($id === null || $id === '') {
            return null;
        }
        $user = User::query()->findOrFail($id);
        $this->assertTenant($user->tenant_id);

        return $user->id;
    }

    /** @param array<string,list<string>> $transitions */
    private function assertTransition(string $current, string $next, array $transitions): void
    {
        if (! in_array($next, $transitions[$current] ?? [], true)) {
            throw new RuntimeException('انتقال حالة أمر الصيانة غير مسموح.');
        }
    }

    private function audit(FuelStation $station, object $subject, string $event, ?array $before, ?array $after, User $actor, mixed $reason): void
    {
        FuelStationReadinessEvent::create([
            'tenant_id' => $station->tenant_id,
            'branch_id' => $station->branch_id,
            'fuel_station_id' => $station->id,
            'subject_type' => $subject::class,
            'subject_id' => $subject->id,
            'event_type' => $event,
            'before' => $before,
            'after' => $after,
            'reason' => $this->optionalText($reason, 500),
            'performed_by' => $actor->id,
            'occurred_at' => now(),
        ]);
    }

    /** @return array<string,mixed> */
    private function snapshot(object $model): array
    {
        return array_intersect_key($model->getAttributes(), array_flip([
            'id', 'number', 'status', 'work_type', 'priority', 'severity', 'assigned_to', 'scheduled_at',
            'started_at', 'completed_at', 'verified_at', 'closed_at', 'cost_minor', 'downtime_minutes',
            'next_due_at', 'last_completed_at',
        ]));
    }

    private function requireTenant(): void
    {
        if (! app(TenantContext::class)->has()) {
            throw new RuntimeException('الصيانة تتطلب سياق مستأجر موثوقاً.');
        }
    }

    private function assertTenant(string $tenantId): void
    {
        $this->requireTenant();
        if ($tenantId !== app(TenantContext::class)->id()) {
            throw new RuntimeException('السجل لا ينتمي إلى المستأجر النشط.');
        }
    }

    private function enum(string $value, array $allowed, string $label): string
    {
        if (! in_array($value, $allowed, true)) {
            throw new RuntimeException("{$label} غير صالح.");
        }
        return $value;
    }

    private function text(mixed $value, string $label, int $max): string
    {
        $value = trim((string) $value);
        if ($value === '' || mb_strlen($value) > $max) {
            throw new RuntimeException("{$label} مطلوب وبحد أقصى {$max} حرفاً.");
        }
        return $value;
    }

    private function optionalText(mixed $value, int $max): ?string
    {
        $value = trim((string) $value);
        if ($value === '') return null;
        if (mb_strlen($value) > $max) throw new RuntimeException('النص يتجاوز الحد المسموح.');
        return $value;
    }

    private function nonNegativeInteger(mixed $value, string $label): int
    {
        if (! is_int($value) || $value < 0) throw new RuntimeException("{$label} يجب أن تكون عدداً صحيحاً غير سالب.");
        return $value;
    }

    private function nullableNonNegativeInteger(mixed $value, string $label): ?int
    {
        return $value === null || $value === '' ? null : $this->nonNegativeInteger($value, $label);
    }

    private function dateTime(mixed $value, string $label): \Carbon\CarbonInterface
    {
        try { return \Carbon\Carbon::parse($value); } catch (\Throwable) { throw new RuntimeException("{$label} غير صالح."); }
    }
}
