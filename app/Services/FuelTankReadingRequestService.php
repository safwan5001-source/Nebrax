<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankReadingRequest;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * FUEL-B6 (تعديل) — طلبات القراءات المتأخرة (سياسة `supervisor_approval`): الكاتب الوحيد لـ`fuel_tank_reading_requests`.
 *
 * - **الإنشاء** يُستدعى من `FuelReconciliationService::recordReading` داخل معاملته بعد قفل صف الخزان وبعد التحقق من السياسة والحد والسبب؛ الطلب لا يدخل
 *   `fuel_tank_readings` ولا يؤثر في آخر قراءة أو المخزون أو الدفتر أو التسوية.
 * - **القرار** (اعتماد/رفض) بصلاحية `fuel.reading.late.approve` ونطاق المحطة (يفرضهما المتحكم)، وهنا القواعد: **لا اعتماد ذاتي** (المقرِّر ≠ مقدِّم الطلب)،
 *   قرار واحد فقط (إعادة القرار نفسه من المقرِّر نفسه idempotent، وغيره 409)، الاعتماد يتطلب أن تبقى سياسة المحطة `supervisor_approval` وأن يبقى التأخير
 *   (وقت التقديم − وقت القياس) ضمن الحد الحالي، والرفض يتطلب ملاحظة. ترتيب الأقفال: الخزان ← الطلب (كمسار الإنشاء الذي يقفل الخزان أولاً).
 * - كل إنشاء وقرار بحدث تدقيق بالفاعل داخل المعاملة نفسها.
 */
class FuelTankReadingRequestService
{
    public const APPROVE_PERMISSION = 'fuel.reading.late.approve';

    public function __construct(private FuelStationSettingsService $settings, private FuelStationAuditTrail $audit) {}

    /** @param array<string,mixed> $evidence */
    public function create(FuelStation $station, FuelTank $tank, string $type, int $milliliters, CarbonImmutable $measuredAt, string $key, string $hash, array $evidence, ?string $reason, mixed $actorId): FuelTankReadingRequest
    {
        $request = FuelTankReadingRequest::query()->forceCreate([
            'tenant_id' => $station->tenant_id,
            'branch_id' => $station->branch_id,
            'fuel_station_id' => $station->id,
            'fuel_tank_id' => $tank->id,
            'reading_type' => $type,
            'quantity_milliliters' => $milliliters,
            'measured_at' => $measuredAt,
            'evidence_key' => $key,
            'intent_hash' => $hash,
            'evidence' => $evidence === [] ? null : $evidence,
            'reason' => $reason,
            'status' => FuelTankReadingRequest::STATUS_PENDING,
            'requested_by' => $actorId,
        ]);
        $this->audit->record(
            'tank_reading.late_requested', $request, null, $this->audit->snapshot($request),
            $actorId === null ? null : User::query()->find($actorId), $reason,
        );

        return $request;
    }

    /** @param 'approve'|'reject' $decision */
    public function decide(string $requestId, User $decider, string $decision, ?string $note): FuelTankReadingRequest
    {
        if (! in_array($decision, ['approve', 'reject'], true)) {
            throw new RuntimeException('قرار غير صالح.');
        }
        $note = is_string($note) && trim($note) !== '' ? mb_substr(trim($note), 0, 500) : null;
        if ($decision === 'reject' && $note === null) {
            throw new RuntimeException('FUEL_READING_REJECTION_NOTE_REQUIRED: سبب رفض القراءة المتأخرة إلزامي.');
        }

        return DB::transaction(function () use ($requestId, $decider, $decision, $note) {
            $peek = FuelTankReadingRequest::query()->findOrFail($requestId);
            $tank = FuelTank::query()->whereKey($peek->fuel_tank_id)->lockForUpdate()->firstOrFail();
            $request = FuelTankReadingRequest::query()->whereKey($requestId)->lockForUpdate()->firstOrFail();
            $wanted = $decision === 'approve' ? FuelTankReadingRequest::STATUS_APPROVED : FuelTankReadingRequest::STATUS_REJECTED;

            if ($request->status !== FuelTankReadingRequest::STATUS_PENDING) {
                if ($request->status === $wanted && $request->decided_by === $decider->id) {
                    return $request; // إعادة القرار نفسه من المقرِّر نفسه: الأثر الأول.
                }
                throw new FuelReadingRequestDecidedException('FUEL_READING_REQUEST_ALREADY_DECIDED: قُرِّر هذا الطلب سابقاً.', $request->status);
            }
            if ($request->requested_by !== null && $request->requested_by === $decider->id) {
                throw new RuntimeException('FUEL_READING_SELF_APPROVAL: لا يجوز البتّ في طلبك بنفسك؛ يقرّره مشرف آخر.');
            }

            $station = FuelStation::query()->findOrFail($request->fuel_station_id);
            $readingId = null;
            if ($decision === 'approve') {
                $policy = $this->settings->tankReadingBackdating($station);
                if ($policy['policy'] !== 'supervisor_approval') {
                    throw new RuntimeException('FUEL_READING_BACKDATING_NOT_ALLOWED: سياسة المحطة الحالية لا تعتمد القراءات المتأخرة بموافقة مشرف.');
                }
                $delay = $request->created_at->getTimestamp() - $request->measured_at->getTimestamp();
                if ($delay > $policy['max_hours'] * 3600) {
                    throw new RuntimeException('FUEL_READING_BACKDATING_TOO_OLD: القراءة أقدم من الحد الأقصى المسموح لتأخير التسجيل في سياسة المحطة ولا تُعتمد.');
                }
                $readingId = app(FuelReconciliationService::class)->materializeLateRequest($request, $station, $tank, $decider)->id;
            }

            $before = $this->audit->snapshot($request);
            $request->forceFill([
                'status' => $wanted,
                'decided_by' => $decider->id,
                'decided_at' => now(),
                'decision_note' => $note,
                'fuel_tank_reading_id' => $readingId,
            ])->save();
            $this->audit->record(
                $decision === 'approve' ? 'tank_reading.late_approved' : 'tank_reading.late_rejected',
                $request, $before, $this->audit->snapshot($request->fresh()), $decider, $note,
            );

            return $request->fresh();
        });
    }
}
