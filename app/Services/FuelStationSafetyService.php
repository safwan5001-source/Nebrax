<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\FuelStationReadinessEvent;
use App\Models\FuelStationSafetyCorrectiveAction;
use App\Models\FuelStationSafetyFinding;
use App\Models\FuelStationSafetyInspection;
use App\Models\FuelStationSafetyPermit;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * خدمات السلامة والامتثال. لا تعالج الفحص كنص عام: النتيجة، finding، الإجراء
 * التصحيحي، والـpermit حقائق منفصلة قابلة للمراجعة والإغلاق المنضبط.
 */
class FuelStationSafetyService
{
    public function __construct(private readonly FuelStationMaintenanceService $maintenance)
    {
    }

    /** @param array<string,mixed> $data */
    public function createInspection(array $data, User $actor): FuelStationSafetyInspection
    {
        $station = $this->station((string) $data['fuel_station_id']);
        $scheduledAt = $this->nullableDateTime($data['scheduled_at'] ?? null, 'موعد الفحص');

        return DB::transaction(function () use ($data, $actor, $station, $scheduledAt) {
            $inspection = FuelStationSafetyInspection::create([
                'tenant_id' => $station->tenant_id,
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'number' => FuelStationSafetyInspection::nextNumber(now()->toDateString(), $station->branch_id),
                'inspection_type' => $this->text($data['inspection_type'] ?? null, 'نوع فحص السلامة', 80),
                'status' => FuelStationSafetyInspection::STATUS_SCHEDULED,
                'scheduled_at' => $scheduledAt,
                'notes' => $this->optionalText($data['notes'] ?? null, 5000),
                'evidence_reference' => $this->optionalText($data['evidence_reference'] ?? null, 500),
            ]);
            $this->audit($station, $inspection, 'safety.inspection.scheduled', null, $this->snapshot($inspection), $actor, $data['reason'] ?? null);

            return $inspection;
        });
    }

    /** @param list<array<string,mixed>> $findings */
    public function performInspection(FuelStationSafetyInspection $inspection, array $findings, User $actor, ?string $reason = null): FuelStationSafetyInspection
    {
        $this->assertTenant($inspection->tenant_id);
        if ($findings === []) {
            throw new RuntimeException('يتطلب الفحص المنفذ قائمة checklist صريحة، حتى عند نجاح كل البنود.');
        }

        return DB::transaction(function () use ($inspection, $findings, $actor, $reason) {
            $inspection = FuelStationSafetyInspection::lockForUpdate()->with('findings')->findOrFail($inspection->id);
            if ($inspection->status !== FuelStationSafetyInspection::STATUS_SCHEDULED) {
                throw new RuntimeException('يمكن تنفيذ فحص سلامة مجدول فقط.');
            }
            $keys = [];
            $normalized = [];
            $station = $this->station($inspection->fuel_station_id);
            foreach ($findings as $finding) {
                $key = $this->text($finding['checklist_key'] ?? null, 'مفتاح قائمة الفحص', 120);
                if (isset($keys[$key])) {
                    throw new RuntimeException('لا يجوز تكرار بند checklist داخل الفحص نفسه.');
                }
                $keys[$key] = true;
                $result = $this->enum((string) ($finding['result'] ?? ''), FuelStationSafetyFinding::RESULTS, 'نتيجة الفحص');
                $severity = $result === FuelStationSafetyFinding::RESULT_FAIL
                    ? $this->enum((string) ($finding['severity'] ?? ''), ['low', 'medium', 'high', 'critical'], 'شدة فشل السلامة')
                    : null;
                $assetType = $assetId = null;
                if (! empty($finding['asset_type']) || ! empty($finding['asset_id'])) {
                    if (empty($finding['asset_type']) || empty($finding['asset_id'])) {
                        throw new RuntimeException('يرجى تقديم نوع ومعرف الأصل معاً لنتيجة الفحص.');
                    }
                    [$assetType, $assetId] = $this->maintenance->assetForStation($station, (string) $finding['asset_type'], (string) $finding['asset_id']);
                }
                $normalized[] = compact('key', 'result', 'severity', 'assetType', 'assetId', 'finding');
            }

            $before = $this->snapshot($inspection);
            $inspection->update([
                'status' => FuelStationSafetyInspection::STATUS_PERFORMED,
                'performed_at' => now(),
                'inspector_id' => $actor->id,
            ]);
            foreach ($normalized as $item) {
                FuelStationSafetyFinding::create([
                    'tenant_id' => $inspection->tenant_id,
                    'branch_id' => $inspection->branch_id,
                    'fuel_station_safety_inspection_id' => $inspection->id,
                    'checklist_key' => $item['key'],
                    'result' => $item['result'],
                    'severity' => $item['severity'],
                    'title' => $this->text($item['finding']['title'] ?? null, 'عنوان نتيجة الفحص', 200),
                    'details' => $this->optionalText($item['finding']['details'] ?? null, 5000),
                    'asset_type' => $item['assetType'],
                    'asset_id' => $item['assetId'],
                ]);
            }
            $inspection->refresh();
            $this->audit($station, $inspection, 'safety.inspection.performed', $before, $this->snapshot($inspection), $actor, $reason);

            return $inspection->fresh(['findings']);
        });
    }

    /** @param array<string,mixed> $data */
    public function createCorrectiveAction(FuelStationSafetyFinding $finding, array $data, User $actor): FuelStationSafetyCorrectiveAction
    {
        $this->assertTenant($finding->tenant_id);
        if ($finding->result !== FuelStationSafetyFinding::RESULT_FAIL) {
            throw new RuntimeException('الإجراء التصحيحي يرتبط بنتيجة سلامة فاشلة فقط.');
        }
        $inspection = $finding->inspection()->firstOrFail();
        if ($inspection->status === FuelStationSafetyInspection::STATUS_CLOSED) {
            throw new RuntimeException('لا يضاف إجراء تصحيحي إلى فحص سلامة مغلق.');
        }
        $assigneeId = $this->tenantUserId($data['assigned_to'] ?? null);

        return DB::transaction(function () use ($finding, $data, $actor, $inspection, $assigneeId) {
            $action = FuelStationSafetyCorrectiveAction::create([
                'tenant_id' => $finding->tenant_id,
                'branch_id' => $finding->branch_id,
                'fuel_station_safety_finding_id' => $finding->id,
                'status' => FuelStationSafetyCorrectiveAction::STATUS_OPEN,
                'title' => $this->text($data['title'] ?? null, 'عنوان الإجراء التصحيحي', 200),
                'description' => $this->optionalText($data['description'] ?? null, 5000),
                'assigned_to' => $assigneeId,
                'due_date' => $this->nullableDate($data['due_date'] ?? null, 'تاريخ استحقاق الإجراء'),
            ]);
            $this->audit($this->station($inspection->fuel_station_id), $action, 'safety.corrective_action.opened', null, $this->snapshot($action), $actor, $data['reason'] ?? null);

            return $action;
        });
    }

    /** @param array<string,mixed> $data */
    public function transitionCorrectiveAction(FuelStationSafetyCorrectiveAction $action, string $nextStatus, array $data, User $actor): FuelStationSafetyCorrectiveAction
    {
        $this->assertTenant($action->tenant_id);
        $nextStatus = $this->enum($nextStatus, FuelStationSafetyCorrectiveAction::STATUSES, 'حالة الإجراء التصحيحي');

        return DB::transaction(function () use ($action, $nextStatus, $data, $actor) {
            $action = FuelStationSafetyCorrectiveAction::lockForUpdate()->with('finding.inspection')->findOrFail($action->id);
            $this->assertTransition($action->status, $nextStatus, [
                FuelStationSafetyCorrectiveAction::STATUS_OPEN => [FuelStationSafetyCorrectiveAction::STATUS_IN_PROGRESS],
                FuelStationSafetyCorrectiveAction::STATUS_IN_PROGRESS => [FuelStationSafetyCorrectiveAction::STATUS_COMPLETED],
                FuelStationSafetyCorrectiveAction::STATUS_COMPLETED => [FuelStationSafetyCorrectiveAction::STATUS_VERIFIED],
                FuelStationSafetyCorrectiveAction::STATUS_VERIFIED => [FuelStationSafetyCorrectiveAction::STATUS_CLOSED],
                FuelStationSafetyCorrectiveAction::STATUS_CLOSED => [],
            ]);
            $before = $this->snapshot($action);
            $changes = ['status' => $nextStatus];
            if ($nextStatus === FuelStationSafetyCorrectiveAction::STATUS_COMPLETED) {
                $changes['completed_at'] = now();
                $changes['resolution'] = $this->text($data['resolution'] ?? null, 'حل الإجراء التصحيحي', 5000);
            }
            if ($nextStatus === FuelStationSafetyCorrectiveAction::STATUS_VERIFIED) {
                $changes['verified_at'] = now();
                $changes['verified_by'] = $actor->id;
            }
            $action->update($changes);
            $action->refresh();
            $station = $this->station($action->finding->inspection->fuel_station_id);
            $this->audit($station, $action, 'safety.corrective_action.' . $nextStatus, $before, $this->snapshot($action), $actor, $data['reason'] ?? null);

            return $action->fresh(['finding', 'assignee', 'verifier']);
        });
    }

    public function verifyInspection(FuelStationSafetyInspection $inspection, User $actor, ?string $reason = null): FuelStationSafetyInspection
    {
        $this->assertTenant($inspection->tenant_id);

        return DB::transaction(function () use ($inspection, $actor, $reason) {
            $inspection = FuelStationSafetyInspection::lockForUpdate()->with('findings.correctiveActions')->findOrFail($inspection->id);
            if ($inspection->status !== FuelStationSafetyInspection::STATUS_PERFORMED) {
                throw new RuntimeException('يُتحقق من فحص سلامة منفذ فقط.');
            }
            foreach ($inspection->findings->where('result', FuelStationSafetyFinding::RESULT_FAIL) as $finding) {
                if ($finding->correctiveActions->isEmpty() || $finding->correctiveActions->contains(fn (FuelStationSafetyCorrectiveAction $action) => $action->status !== FuelStationSafetyCorrectiveAction::STATUS_CLOSED)) {
                    throw new RuntimeException('لا يتحقق فحص يحوي فشلاً قبل إغلاق جميع إجراءاته التصحيحية.');
                }
            }
            $before = $this->snapshot($inspection);
            $inspection->update(['status' => FuelStationSafetyInspection::STATUS_VERIFIED, 'verified_at' => now(), 'verified_by' => $actor->id]);
            $inspection->refresh();
            $this->audit($this->station($inspection->fuel_station_id), $inspection, 'safety.inspection.verified', $before, $this->snapshot($inspection), $actor, $reason);

            return $inspection;
        });
    }

    public function closeInspection(FuelStationSafetyInspection $inspection, User $actor, ?string $reason = null): FuelStationSafetyInspection
    {
        $this->assertTenant($inspection->tenant_id);

        return DB::transaction(function () use ($inspection, $actor, $reason) {
            $inspection = FuelStationSafetyInspection::lockForUpdate()->findOrFail($inspection->id);
            if ($inspection->status !== FuelStationSafetyInspection::STATUS_VERIFIED) {
                throw new RuntimeException('يُغلق فحص سلامة متحقق منه فقط.');
            }
            $before = $this->snapshot($inspection);
            $inspection->update(['status' => FuelStationSafetyInspection::STATUS_CLOSED, 'closed_at' => now()]);
            $inspection->refresh();
            $this->audit($this->station($inspection->fuel_station_id), $inspection, 'safety.inspection.closed', $before, $this->snapshot($inspection), $actor, $reason);

            return $inspection;
        });
    }

    /** @param array<string,mixed> $data */
    public function createPermit(array $data, User $actor): FuelStationSafetyPermit
    {
        $station = $this->station((string) $data['fuel_station_id']);
        $assetType = $assetId = null;
        if (! empty($data['asset_type']) || ! empty($data['asset_id'])) {
            if (empty($data['asset_type']) || empty($data['asset_id'])) throw new RuntimeException('يرجى تقديم نوع ومعرف الأصل معاً للتصريح.');
            [$assetType, $assetId] = $this->maintenance->assetForStation($station, (string) $data['asset_type'], (string) $data['asset_id']);
        }
        $issued = $this->nullableDate($data['issued_on'] ?? null, 'تاريخ إصدار التصريح');
        $expires = $this->nullableDate($data['expires_on'] ?? null, 'تاريخ انتهاء التصريح');
        if ($issued && $expires && $expires->lt($issued)) throw new RuntimeException('تاريخ انتهاء التصريح يسبق تاريخ إصداره.');

        return DB::transaction(function () use ($data, $actor, $station, $assetType, $assetId, $issued, $expires) {
            $permit = FuelStationSafetyPermit::create([
                'tenant_id' => $station->tenant_id,
                'branch_id' => $station->branch_id,
                'fuel_station_id' => $station->id,
                'permit_type' => $this->text($data['permit_type'] ?? null, 'نوع التصريح أو الشهادة', 100),
                'reference' => $this->text($data['reference'] ?? null, 'مرجع التصريح أو الشهادة', 160),
                'status' => FuelStationSafetyPermit::STATUS_ACTIVE,
                'issued_on' => $issued,
                'expires_on' => $expires,
                'asset_type' => $assetType,
                'asset_id' => $assetId,
                'evidence_reference' => $this->optionalText($data['evidence_reference'] ?? null, 500),
                'created_by' => $actor->id,
            ]);
            $this->audit($station, $permit, 'safety.permit.created', null, $this->snapshot($permit), $actor, $data['reason'] ?? null);

            return $permit;
        });
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
        if ($id === null || $id === '') return null;
        $user = User::query()->findOrFail($id);
        $this->assertTenant($user->tenant_id);
        return $user->id;
    }

    /** @param array<string,list<string>> $transitions */
    private function assertTransition(string $current, string $next, array $transitions): void
    {
        if (! in_array($next, $transitions[$current] ?? [], true)) throw new RuntimeException('انتقال حالة الإجراء التصحيحي غير مسموح.');
    }

    private function audit(FuelStation $station, object $subject, string $event, ?array $before, ?array $after, User $actor, mixed $reason): void
    {
        FuelStationReadinessEvent::create([
            'tenant_id' => $station->tenant_id, 'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id,
            'subject_type' => $subject::class, 'subject_id' => $subject->id, 'event_type' => $event,
            'before' => $before, 'after' => $after, 'reason' => $this->optionalText($reason, 500),
            'performed_by' => $actor->id, 'occurred_at' => now(),
        ]);
    }

    /** @return array<string,mixed> */
    private function snapshot(object $model): array
    {
        return array_intersect_key($model->getAttributes(), array_flip([
            'id', 'number', 'status', 'inspection_type', 'result', 'severity', 'assigned_to', 'due_date',
            'scheduled_at', 'performed_at', 'completed_at', 'verified_at', 'closed_at', 'expires_on',
        ]));
    }

    private function requireTenant(): void
    {
        if (! app(TenantContext::class)->has()) throw new RuntimeException('السلامة تتطلب سياق مستأجر موثوقاً.');
    }

    private function assertTenant(string $tenantId): void
    {
        $this->requireTenant();
        if ($tenantId !== app(TenantContext::class)->id()) throw new RuntimeException('السجل لا ينتمي إلى المستأجر النشط.');
    }

    private function enum(string $value, array $allowed, string $label): string
    {
        if (! in_array($value, $allowed, true)) throw new RuntimeException("{$label} غير صالح.");
        return $value;
    }

    private function text(mixed $value, string $label, int $max): string
    {
        $value = trim((string) $value);
        if ($value === '' || mb_strlen($value) > $max) throw new RuntimeException("{$label} مطلوب وبحد أقصى {$max} حرفاً.");
        return $value;
    }

    private function optionalText(mixed $value, int $max): ?string
    {
        $value = trim((string) $value);
        if ($value === '') return null;
        if (mb_strlen($value) > $max) throw new RuntimeException('النص يتجاوز الحد المسموح.');
        return $value;
    }

    private function nullableDateTime(mixed $value, string $label): ?\Carbon\CarbonInterface
    {
        if ($value === null || $value === '') return null;
        try { return \Carbon\Carbon::parse($value); } catch (\Throwable) { throw new RuntimeException("{$label} غير صالح."); }
    }

    private function nullableDate(mixed $value, string $label): ?\Carbon\CarbonInterface
    {
        return $this->nullableDateTime($value, $label)?->startOfDay();
    }
}
