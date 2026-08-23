<?php

namespace App\Services;

use App\Models\FuelDelivery;
use App\Models\FuelNozzle;
use App\Models\FuelShift;
use App\Models\FuelShiftCashMovement;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelShiftCorrection;
use App\Models\FuelShiftEvent;
use App\Models\FuelShiftMeterReading;
use App\Models\FuelShiftStaffAssignment;
use App\Models\FuelShiftTankReading;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\User;
use App\Tenancy\BranchContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * دورة الشفت التشغيلية لمحطة الوقود.
 *
 * لا تُنشئ هذه الخدمة FuelSale أو Payment أو Invoice أو قيداً محاسبياً. قراءات
 * العداد وحركات النقد هنا مؤشرات تشغيلية مدققة فقط؛ Cycle 5 سيربط البيع والدفع
 * الرسميين بالشفت بدلاً من إنشاء محرك موازٍ.
 */
class FuelShiftService
{
    public function __construct(
        private FuelStationSettingsService $settings,
        private FuelQuantity $quantity,
    ) {}

    /** @param array<string,mixed> $attributes */
    public function open(array $attributes, User $actor): FuelShift
    {
        $this->requirePermission($actor, 'fuel.shift.open');
        $stationId = $this->requiredString($attributes, 'fuel_station_id');
        $idempotencyKey = $this->requiredString($attributes, 'idempotency_key');
        $openingFloat = $this->nonNegativeInteger($attributes['opening_float_minor'] ?? 0, 'opening_float_minor');
        $activeTerminalKeys = $this->terminalKeys($attributes['active_terminal_keys'] ?? []);

        try {
            return DB::transaction(function () use ($stationId, $idempotencyKey, $openingFloat, $activeTerminalKeys, $attributes, $actor) {
                $station = FuelStation::lockForUpdate()->findOrFail($stationId);
                $this->assertStationBranch($station);
                $policy = $this->settings->forStation($station);
                if ($policy['shift_opening_cash_float_required'] && ! array_key_exists('opening_float_minor', $attributes)) {
                    throw new RuntimeException('سياسة المحطة تتطلب تسجيل float نقدي افتتاحي صريح، ولو كانت قيمته صفراً.');
                }

                $existing = FuelShift::where('idempotency_key', $idempotencyKey)->first();
                if ($existing !== null) {
                    if ($existing->fuel_station_id !== $station->id) {
                        throw new RuntimeException('مفتاح منع التكرار استُخدم سابقاً لوردية محطة أخرى.');
                    }

                    return $existing;
                }
                if (FuelShift::where('fuel_station_id', $station->id)->where('status', FuelShift::STATUS_OPEN)->exists()) {
                    throw new RuntimeException('توجد وردية وقود مفتوحة للمحطة؛ يجب إغلاقها أو تصحيحها عبر المسار المدقق أولاً.');
                }

                $shift = FuelShift::create([
                    'branch_id' => $station->branch_id,
                    'fuel_station_id' => $station->id,
                    'number' => FuelShift::nextDocumentNumber('FSH', now()->toDateString(), $station->branch_id),
                    'status' => FuelShift::STATUS_OPEN,
                    'opening_float_minor' => $openingFloat,
                    'active_terminal_keys' => $activeTerminalKeys,
                    'opening_note' => $this->nullableText($attributes['opening_note'] ?? null),
                    'opened_by' => $actor->id,
                    'opened_at' => now(),
                    'idempotency_key' => $idempotencyKey,
                ]);
                $this->event($shift, FuelShiftEvent::TYPE_OPENED, $actor, [
                    'opening_float_minor' => $openingFloat,
                    'active_terminal_keys' => $activeTerminalKeys,
                ]);

                return $shift->fresh();
            });
        } catch (QueryException $e) {
            throw new RuntimeException('تعذر فتح الشفت بسبب تضارب متزامن؛ أعد تحميل المحطة ولا تنشئ وردية ثانية.', previous: $e);
        }
    }

    public function assignStaff(FuelShift $shift, string $userId, string $role, User $actor): FuelShiftStaffAssignment
    {
        $this->requirePermission($actor, 'fuel.shift.open');
        $role = trim($role);
        if ($role === '') {
            throw new RuntimeException('دور العامل في الشفت مطلوب.');
        }

        return DB::transaction(function () use ($shift, $userId, $role, $actor) {
            $shift = $this->lockOpenShift($shift);
            $staff = User::findOrFail($userId);
            if (! $staff->canAccessBranch($shift->branch_id)) {
                throw new RuntimeException('العامل لا يملك نطاق الوصول لفرع الشفت.');
            }
            if (FuelShiftStaffAssignment::where('fuel_shift_id', $shift->id)->where('user_id', $staff->id)->exists()) {
                throw new RuntimeException('العامل مسند بالفعل إلى هذا الشفت.');
            }

            $assignment = FuelShiftStaffAssignment::create([
                'branch_id' => $shift->branch_id,
                'fuel_shift_id' => $shift->id,
                'user_id' => $staff->id,
                'role' => $role,
                'assigned_by' => $actor->id,
                'assigned_at' => now(),
            ]);
            $this->event($shift, FuelShiftEvent::TYPE_STAFF_ASSIGNED, $actor, [
                'assignment_id' => $assignment->id, 'user_id' => $staff->id, 'role' => $role,
            ]);

            return $assignment;
        });
    }

    /** @param array<string,mixed> $attributes */
    public function recordMeter(FuelShift $shift, array $attributes, User $actor): FuelShiftMeterReading
    {
        $this->requirePermission($actor, 'fuel.shift.open');
        $stage = $this->stage($attributes['reading_stage'] ?? null);
        $evidenceKey = $this->requiredString($attributes, 'evidence_key');
        $meter = $this->meterQuantity($attributes);
        if ($meter < 0) {
            throw new RuntimeException('قراءة العداد لا تكون سالبة.');
        }

        return DB::transaction(function () use ($shift, $attributes, $actor, $stage, $evidenceKey, $meter) {
            $shift = $this->lockOpenShift($shift);
            $nozzle = FuelNozzle::findOrFail($this->requiredString($attributes, 'fuel_nozzle_id'));
            $this->assertNozzleForShift($nozzle, $shift);
            $existingEvidence = FuelShiftMeterReading::where('evidence_key', $evidenceKey)->first();
            if ($existingEvidence !== null) {
                if ($existingEvidence->fuel_shift_id === $shift->id
                    && $existingEvidence->fuel_nozzle_id === $nozzle->id
                    && $existingEvidence->reading_stage === $stage
                    && (int) $existingEvidence->meter_milliliters === $meter) {
                    return $existingEvidence;
                }
                throw new RuntimeException('مفتاح دليل قراءة العداد استُخدم سابقاً لسجل مختلف.');
            }
            if (FuelShiftMeterReading::where('fuel_shift_id', $shift->id)->where('fuel_nozzle_id', $nozzle->id)->where('reading_stage', $stage)->exists()) {
                throw new RuntimeException('قراءة العداد لهذه الفوهة والمرحلة مسجلة بالفعل ولا يعاد استخدامها.');
            }

            $reading = FuelShiftMeterReading::create([
                'branch_id' => $shift->branch_id,
                'fuel_shift_id' => $shift->id,
                'fuel_nozzle_id' => $nozzle->id,
                'reading_stage' => $stage,
                'meter_milliliters' => $meter,
                'evidence_key' => $evidenceKey,
                'evidence' => $attributes['evidence'] ?? null,
                'recorded_by' => $actor->id,
                'measured_at' => $attributes['measured_at'] ?? now(),
            ]);
            $this->event($shift, FuelShiftEvent::TYPE_METER_RECORDED, $actor, [
                'reading_id' => $reading->id, 'nozzle_id' => $nozzle->id, 'stage' => $stage, 'meter_milliliters' => $meter,
            ]);

            return $reading;
        });
    }

    /** @param array<string,mixed> $attributes */
    public function recordTank(FuelShift $shift, array $attributes, User $actor): FuelShiftTankReading
    {
        $this->requirePermission($actor, 'fuel.shift.open');
        $stage = $this->stage($attributes['reading_stage'] ?? null);
        $type = $attributes['reading_type'] ?? FuelShiftTankReading::TYPE_PHYSICAL;
        if (! in_array($type, FuelShiftTankReading::TYPES, true)) {
            throw new RuntimeException('نوع قراءة خزان الشفت يجب أن يكون physical أو atg.');
        }
        $evidenceKey = $this->requiredString($attributes, 'evidence_key');
        $quantity = $this->tankQuantity($attributes);

        return DB::transaction(function () use ($shift, $attributes, $actor, $stage, $type, $evidenceKey, $quantity) {
            $shift = $this->lockOpenShift($shift);
            $tank = FuelTank::findOrFail($this->requiredString($attributes, 'fuel_tank_id'));
            $this->assertTankForShift($tank, $shift);
            $existingEvidence = FuelShiftTankReading::where('evidence_key', $evidenceKey)->first();
            if ($existingEvidence !== null) {
                if ($existingEvidence->fuel_shift_id === $shift->id
                    && $existingEvidence->fuel_tank_id === $tank->id
                    && $existingEvidence->reading_stage === $stage
                    && $existingEvidence->reading_type === $type
                    && (int) $existingEvidence->quantity_milliliters === $quantity) {
                    return $existingEvidence;
                }
                throw new RuntimeException('مفتاح دليل قراءة الخزان استُخدم سابقاً لسجل مختلف.');
            }
            if (FuelShiftTankReading::where('fuel_shift_id', $shift->id)->where('fuel_tank_id', $tank->id)->where('reading_stage', $stage)->exists()) {
                throw new RuntimeException('قراءة الخزان لهذه المرحلة مسجلة بالفعل ولا يعاد استخدامها.');
            }

            $reading = FuelShiftTankReading::create([
                'branch_id' => $shift->branch_id,
                'fuel_shift_id' => $shift->id,
                'fuel_tank_id' => $tank->id,
                'reading_stage' => $stage,
                'reading_type' => $type,
                'quantity_milliliters' => $quantity,
                'evidence_key' => $evidenceKey,
                'evidence' => $attributes['evidence'] ?? null,
                'recorded_by' => $actor->id,
                'measured_at' => $attributes['measured_at'] ?? now(),
            ]);
            $this->event($shift, FuelShiftEvent::TYPE_TANK_RECORDED, $actor, [
                'reading_id' => $reading->id, 'tank_id' => $tank->id, 'stage' => $stage,
                'reading_type' => $type, 'quantity_milliliters' => $quantity,
            ]);

            return $reading;
        });
    }

    /** @param array<string,mixed> $attributes */
    public function recordCashMovement(FuelShift $shift, array $attributes, User $actor): FuelShiftCashMovement
    {
        $this->requirePermission($actor, 'fuel.shift.cash_count');
        $type = $attributes['type'] ?? null;
        if (! in_array($type, FuelShiftCashMovement::TYPES, true)) {
            throw new RuntimeException('نوع حركة النقد التشغيلي غير صالح.');
        }
        $amount = $this->positiveInteger($attributes['amount_minor'] ?? null, 'amount_minor');
        $reason = $this->requiredString($attributes, 'reason');
        $idempotencyKey = $this->requiredString($attributes, 'idempotency_key');

        return DB::transaction(function () use ($shift, $attributes, $actor, $type, $amount, $reason, $idempotencyKey) {
            $shift = $this->lockOpenShift($shift);
            $existing = FuelShiftCashMovement::where('idempotency_key', $idempotencyKey)->first();
            if ($existing !== null) {
                if ($existing->fuel_shift_id !== $shift->id) {
                    throw new RuntimeException('مفتاح منع التكرار استُخدم لحركة شفت أخرى.');
                }
                return $existing;
            }
            $cash = $this->cashTotals($shift);
            if (in_array($type, [FuelShiftCashMovement::TYPE_CASH_OUT, FuelShiftCashMovement::TYPE_EXPENSE], true)
                && $amount > $shift->opening_float_minor + $cash['cash_in'] - $cash['cash_out'] - $cash['expenses']) {
                throw new RuntimeException('لا يمكن إخراج أو تسجيل مصروف نقدي يتجاوز الرصيد التشغيلي المتوقع للشفت.');
            }

            $movement = FuelShiftCashMovement::create([
                'branch_id' => $shift->branch_id,
                'fuel_shift_id' => $shift->id,
                'type' => $type,
                'amount_minor' => $amount,
                'reason' => $reason,
                'evidence' => $attributes['evidence'] ?? null,
                'idempotency_key' => $idempotencyKey,
                'recorded_by' => $actor->id,
                'recorded_at' => $attributes['recorded_at'] ?? now(),
            ]);
            $this->event($shift, FuelShiftEvent::TYPE_CASH_MOVEMENT_RECORDED, $actor, [
                'cash_movement_id' => $movement->id, 'type' => $type, 'amount_minor' => $amount, 'reason' => $reason,
            ]);

            return $movement;
        });
    }

    public function close(FuelShift $shift, int $countedCashMinor, ?string $closingNote, User $actor): FuelShift
    {
        $this->requirePermission($actor, 'fuel.shift.close');
        $this->requirePermission($actor, 'fuel.shift.cash_count');
        if ($countedCashMinor < 0) {
            throw new RuntimeException('النقد المعدود لا يكون سالباً.');
        }

        return DB::transaction(function () use ($shift, $countedCashMinor, $closingNote, $actor) {
            $shift = $this->lockOpenShift($shift);
            $station = FuelStation::findOrFail($shift->fuel_station_id);
            $policy = $this->settings->forStation($station);
            $this->assertCloseReadiness($shift, $station, $policy);

            $cash = $this->cashTotals($shift);
            $expectedCash = (int) $shift->opening_float_minor + $cash['cash_in'] - $cash['cash_out'] - $cash['expenses'];
            $variance = $countedCashMinor - $expectedCash;
            if ($variance !== 0 && ! $policy['shift_allow_close_with_pending_cash_variance']) {
                throw new RuntimeException('سياسة المحطة تمنع إغلاق الشفت قبل حل فرق النقد التشغيلي.');
            }

            $meterTotal = $this->meterDelta($shift);
            $tank = $this->tankOperationalComparison($shift);
            $tankVarianceStatus = $tank['variance_milliliters'] === null
                ? 'not_available'
                : (abs($tank['variance_milliliters']) <= $policy['shift_tank_tolerance_milliliters'] ? 'within_tolerance' : 'pending_review');
            if ($tankVarianceStatus === 'pending_review' && ! $policy['shift_allow_close_with_unresolved_operational_variance']) {
                throw new RuntimeException('سياسة المحطة تمنع إغلاق الشفت مع فرق خزان تشغيلي خارج التفاوت المعتمد.');
            }
            $direction = $variance === 0 ? FuelShiftCashVariance::DIRECTION_NONE : ($variance > 0 ? FuelShiftCashVariance::DIRECTION_OVERAGE : FuelShiftCashVariance::DIRECTION_SHORTAGE);
            $varianceStatus = $variance === 0 ? FuelShiftCashVariance::STATUS_NOT_REQUIRED : FuelShiftCashVariance::STATUS_PENDING_REVIEW;
            $cashVariance = FuelShiftCashVariance::create([
                'branch_id' => $shift->branch_id,
                'fuel_station_id' => $station->id,
                'fuel_shift_id' => $shift->id,
                'opening_float_minor' => $shift->opening_float_minor,
                'documented_cash_in_minor' => $cash['cash_in'],
                'documented_cash_out_minor' => $cash['cash_out'],
                'documented_expenses_minor' => $cash['expenses'],
                'expected_operational_cash_minor' => $expectedCash,
                'counted_cash_minor' => $countedCashMinor,
                'variance_minor' => $variance,
                'variance_direction' => $direction,
                'status' => $varianceStatus,
                'note' => $this->nullableText($closingNote),
                'counted_by' => $actor->id,
                'counted_at' => now(),
            ]);
            $shift->update([
                'status' => FuelShift::STATUS_CLOSED,
                'counted_cash_minor' => $countedCashMinor,
                'expected_operational_cash_minor' => $expectedCash,
                'cash_variance_minor' => $variance,
                'operational_meter_milliliters' => $meterTotal,
                'operational_delivery_milliliters' => $tank['deliveries_milliliters'],
                'operational_tank_variance_milliliters' => $tank['variance_milliliters'],
                'closing_note' => $this->nullableText($closingNote),
                'closed_by' => $actor->id,
                'closed_at' => now(),
            ]);
            $this->event($shift, FuelShiftEvent::TYPE_CLOSED, $actor, [
                'counted_cash_minor' => $countedCashMinor,
                'expected_operational_cash_minor' => $expectedCash,
                'cash_variance_minor' => $variance,
                'operational_meter_milliliters' => $meterTotal,
                'operational_delivery_milliliters' => $tank['deliveries_milliliters'],
                'operational_tank_variance_milliliters' => $tank['variance_milliliters'],
                'operational_tank_variance_status' => $tankVarianceStatus,
                'operational_tank_tolerance_milliliters' => $policy['shift_tank_tolerance_milliliters'],
                'cash_variance_id' => $cashVariance->id,
            ]);
            if ($variance !== 0) {
                $this->event($shift, FuelShiftEvent::TYPE_CASH_VARIANCE_PENDING, $actor, [
                    'cash_variance_id' => $cashVariance->id, 'variance_minor' => $variance, 'direction' => $direction,
                ]);
            }

            return $shift->fresh();
        });
    }

    public function approve(FuelShift $shift, ?string $note, User $actor): FuelShift
    {
        $this->requirePermission($actor, 'fuel.shift.approve');

        return DB::transaction(function () use ($shift, $note, $actor) {
            $shift = FuelShift::lockForUpdate()->findOrFail($shift->id);
            if (! $shift->isClosed()) {
                throw new RuntimeException('لا تعتمد إلا وردية مغلقة.');
            }
            $station = FuelStation::findOrFail($shift->fuel_station_id);
            $this->assertStationBranch($station);
            $policy = $this->settings->forStation($station);
            if ($policy['shift_supervisor_approval_required'] && $shift->opened_by === $actor->id) {
                throw new RuntimeException('سياسة المحطة تتطلب اعتماد الشفت من مشرف مختلف عن فاتح الشفت.');
            }

            $shift->update([
                'status' => FuelShift::STATUS_APPROVED,
                'approved_by' => $actor->id,
                'approved_at' => now(),
                'locked_at' => now(),
            ]);
            $this->event($shift, FuelShiftEvent::TYPE_APPROVED_LOCKED, $actor, ['note' => $this->nullableText($note)]);

            return $shift->fresh();
        });
    }

    public function reviewCashVariance(FuelShift $shift, string $note, User $actor): FuelShiftCashVariance
    {
        $this->requirePermission($actor, 'fuel.shift.cash_variance_review');
        $note = $this->requiredString(['note' => $note], 'note');

        return DB::transaction(function () use ($shift, $note, $actor) {
            $shift = FuelShift::lockForUpdate()->findOrFail($shift->id);
            $this->assertStationBranch(FuelStation::findOrFail($shift->fuel_station_id));
            if (! $shift->isClosed() && ! $shift->isApproved()) {
                throw new RuntimeException('لا تراجع فرق النقد إلا بعد إغلاق الشفت.');
            }
            $variance = FuelShiftCashVariance::where('fuel_shift_id', $shift->id)->lockForUpdate()->firstOrFail();
            if ($variance->status !== FuelShiftCashVariance::STATUS_PENDING_REVIEW) {
                throw new RuntimeException('لا يوجد فرق نقد تشغيلي معلق للمراجعة في هذا الشفت.');
            }
            if ($variance->reviewed_at !== null) {
                throw new RuntimeException('تمت مراجعة فرق النقد لهذا الشفت بالفعل؛ يبقى الفرق محفوظاً ولا يسوّى تلقائياً.');
            }

            $variance->update(['reviewed_by' => $actor->id, 'reviewed_at' => now()]);
            $this->event($shift, FuelShiftEvent::TYPE_CASH_VARIANCE_REVIEWED, $actor, [
                'cash_variance_id' => $variance->id,
                'variance_minor' => (int) $variance->variance_minor,
                'note' => $note,
                'status_remains' => FuelShiftCashVariance::STATUS_PENDING_REVIEW,
            ]);

            return $variance->fresh();
        });
    }

    /** @param array<string,mixed> $attributes */
    public function requestCorrection(FuelShift $shift, array $attributes, User $actor): FuelShiftCorrection
    {
        $this->requirePermission($actor, 'fuel.shift.correct');
        $target = $attributes['target_type'] ?? null;
        if (! in_array($target, FuelShiftCorrection::TARGETS, true)) {
            throw new RuntimeException('هدف correction الشفت غير صالح.');
        }
        $reason = $this->requiredString($attributes, 'reason');
        $proposed = $attributes['proposed'] ?? null;
        if (! is_array($proposed) || $proposed === []) {
            throw new RuntimeException('التعديل المقترح مطلوب ولا يطبّق مباشرة على السجل المقفل.');
        }

        return DB::transaction(function () use ($shift, $attributes, $actor, $target, $reason, $proposed) {
            $shift = FuelShift::lockForUpdate()->findOrFail($shift->id);
            $this->assertStationBranch(FuelStation::findOrFail($shift->fuel_station_id));
            if (! $shift->isApproved()) {
                throw new RuntimeException('طلبات correction مخصصة للشفت المعتمد والمقفل فقط.');
            }
            [$targetId, $before] = $this->correctionTarget($shift, $target, $attributes['target_id'] ?? null);
            $correction = FuelShiftCorrection::create([
                'branch_id' => $shift->branch_id,
                'fuel_shift_id' => $shift->id,
                'target_type' => $target,
                'target_id' => $targetId,
                'before' => $before,
                'proposed' => $proposed,
                'status' => FuelShiftCorrection::STATUS_REQUESTED,
                'reason' => $reason,
                'requested_by' => $actor->id,
                'requested_at' => now(),
            ]);
            $this->event($shift, FuelShiftEvent::TYPE_CORRECTION_REQUESTED, $actor, [
                'correction_id' => $correction->id, 'target_type' => $target, 'target_id' => $targetId,
            ]);

            return $correction;
        });
    }

    private function lockOpenShift(FuelShift $shift): FuelShift
    {
        $shift = FuelShift::lockForUpdate()->findOrFail($shift->id);
        $this->assertStationBranch(FuelStation::findOrFail($shift->fuel_station_id));
        if (! $shift->isOpen()) {
            throw new RuntimeException('الشفت ليس مفتوحاً ولا يقبل حركة تشغيلية جديدة.');
        }

        return $shift;
    }

    /** @param array<string,mixed> $policy */
    private function assertCloseReadiness(FuelShift $shift, FuelStation $station, array $policy): void
    {
        if ($policy['shift_mandatory_staff_assignment'] && ! FuelShiftStaffAssignment::where('fuel_shift_id', $shift->id)->exists()) {
            throw new RuntimeException('سياسة المحطة تتطلب إسناد عامل واحد على الأقل قبل إغلاق الشفت.');
        }
        $activeNozzles = FuelNozzle::where('fuel_station_id', $station->id)->where('status', FuelNozzle::STATUS_ACTIVE)->pluck('id')->all();
        $activeTanks = FuelTank::where('fuel_station_id', $station->id)->where('status', FuelTank::STATUS_ACTIVE)->pluck('id')->all();
        if ($policy['shift_opening_meter_reading_required']) {
            $this->assertStageCoverage(FuelShiftMeterReading::class, 'fuel_nozzle_id', $shift->id, FuelShiftMeterReading::STAGE_OPENING, $activeNozzles, 'افتتاحية للعدادات');
        }
        if ($policy['shift_closing_meter_reading_required']) {
            $this->assertStageCoverage(FuelShiftMeterReading::class, 'fuel_nozzle_id', $shift->id, FuelShiftMeterReading::STAGE_CLOSING, $activeNozzles, 'ختامية للعدادات');
        }
        if ($policy['shift_opening_tank_reading_required']) {
            $this->assertStageCoverage(FuelShiftTankReading::class, 'fuel_tank_id', $shift->id, FuelShiftTankReading::STAGE_OPENING, $activeTanks, 'افتتاحية للخزانات');
        }
        if ($policy['shift_closing_tank_reading_required']) {
            $this->assertStageCoverage(FuelShiftTankReading::class, 'fuel_tank_id', $shift->id, FuelShiftTankReading::STAGE_CLOSING, $activeTanks, 'ختامية للخزانات');
        }
    }

    /** @param class-string<\Illuminate\Database\Eloquent\Model> $model @param array<int,string> $ids */
    private function assertStageCoverage(string $model, string $column, string $shiftId, string $stage, array $ids, string $label): void
    {
        if ($ids === []) {
            return;
        }
        $recorded = $model::where('fuel_shift_id', $shiftId)->where('reading_stage', $stage)->pluck($column)->all();
        if (array_diff($ids, $recorded) !== []) {
            throw new RuntimeException("سياسة المحطة تتطلب قراءات {$label} لكل أصول المحطة النشطة قبل إغلاق الشفت.");
        }
    }

    /** @return array{cash_in:int,cash_out:int,expenses:int} */
    private function cashTotals(FuelShift $shift): array
    {
        return [
            'cash_in' => (int) FuelShiftCashMovement::where('fuel_shift_id', $shift->id)->where('type', FuelShiftCashMovement::TYPE_CASH_IN)->sum('amount_minor'),
            'cash_out' => (int) FuelShiftCashMovement::where('fuel_shift_id', $shift->id)->where('type', FuelShiftCashMovement::TYPE_CASH_OUT)->sum('amount_minor'),
            'expenses' => (int) FuelShiftCashMovement::where('fuel_shift_id', $shift->id)->where('type', FuelShiftCashMovement::TYPE_EXPENSE)->sum('amount_minor'),
        ];
    }

    private function meterDelta(FuelShift $shift): int
    {
        $readings = FuelShiftMeterReading::where('fuel_shift_id', $shift->id)->get()->groupBy('fuel_nozzle_id');
        $total = 0;
        foreach ($readings as $pair) {
            $opening = $pair->firstWhere('reading_stage', FuelShiftMeterReading::STAGE_OPENING);
            $closing = $pair->firstWhere('reading_stage', FuelShiftMeterReading::STAGE_CLOSING);
            if ($opening === null || $closing === null) {
                continue;
            }
            $delta = (int) $closing->meter_milliliters - (int) $opening->meter_milliliters;
            if ($delta < 0) {
                throw new RuntimeException('قراءة إغلاق العداد لا تكون أقل من قراءة الفتح لنفس الفوهة.');
            }
            $total += $delta;
        }

        return $total;
    }

    /** @return array{deliveries_milliliters:int,variance_milliliters:int|null} */
    private function tankOperationalComparison(FuelShift $shift): array
    {
        $readings = FuelShiftTankReading::where('fuel_shift_id', $shift->id)->get()->groupBy('fuel_tank_id');
        $openingTotal = 0;
        $closingTotal = 0;
        $hasCompletePair = false;
        foreach ($readings as $pair) {
            $opening = $pair->firstWhere('reading_stage', FuelShiftTankReading::STAGE_OPENING);
            $closing = $pair->firstWhere('reading_stage', FuelShiftTankReading::STAGE_CLOSING);
            if ($opening === null || $closing === null) {
                continue;
            }
            if ($opening->reading_type !== $closing->reading_type) {
                throw new RuntimeException('نوع قراءة فتح وإغلاق الخزان يجب أن يبقى متطابقاً داخل الشفت.');
            }
            $openingTotal += (int) $opening->quantity_milliliters;
            $closingTotal += (int) $closing->quantity_milliliters;
            $hasCompletePair = true;
        }
        $deliveries = (int) FuelDelivery::where('fuel_station_id', $shift->fuel_station_id)
            ->where('status', FuelDelivery::STATUS_APPROVED)
            ->whereBetween('approved_at', [$shift->opened_at, now()])
            ->sum('received_milliliters');
        $meterTotal = $this->meterDelta($shift);

        return [
            'deliveries_milliliters' => $deliveries,
            // مؤشر تشغيلي فقط: لا يغيّر Book Stock ولا يحل محل تسوية المخزون الرسمية.
            'variance_milliliters' => $hasCompletePair ? $openingTotal + $deliveries - $meterTotal - $closingTotal : null,
        ];
    }

    /** @return array{0:?string,1:array<string,mixed>} */
    private function correctionTarget(FuelShift $shift, string $target, mixed $targetId): array
    {
        return match ($target) {
            FuelShiftCorrection::TARGET_METER_READING => $this->readingCorrectionTarget(FuelShiftMeterReading::class, $shift, $targetId),
            FuelShiftCorrection::TARGET_TANK_READING => $this->readingCorrectionTarget(FuelShiftTankReading::class, $shift, $targetId),
            FuelShiftCorrection::TARGET_CASH_COUNT => [null, ['counted_cash_minor' => $shift->counted_cash_minor, 'cash_variance_minor' => $shift->cash_variance_minor]],
        };
    }

    /** @param class-string<\Illuminate\Database\Eloquent\Model> $model @return array{0:string,1:array<string,mixed>} */
    private function readingCorrectionTarget(string $model, FuelShift $shift, mixed $targetId): array
    {
        if (! is_string($targetId) || trim($targetId) === '') {
            throw new RuntimeException('معرّف الدليل المراد تصحيحه مطلوب.');
        }
        $reading = $model::where('fuel_shift_id', $shift->id)->findOrFail($targetId);

        return [$reading->id, $reading->getAttributes()];
    }

    private function assertStationBranch(FuelStation $station): void
    {
        $activeBranchId = app(BranchContext::class)->id();
        if ($activeBranchId !== null && $station->branch_id !== $activeBranchId) {
            throw new RuntimeException('محطة الشفت لا تخص الفرع النشط.');
        }
        if ($station->status !== FuelStation::STATUS_ACTIVE) {
            throw new RuntimeException('لا يمكن تشغيل شفت على محطة غير نشطة.');
        }
    }

    private function assertNozzleForShift(FuelNozzle $nozzle, FuelShift $shift): void
    {
        if ($nozzle->fuel_station_id !== $shift->fuel_station_id || $nozzle->branch_id !== $shift->branch_id || $nozzle->status !== FuelNozzle::STATUS_ACTIVE) {
            throw new RuntimeException('الفوهة لا تنتمي إلى المحطة أو الفرع النشطين، أو ليست متاحة تشغيلياً.');
        }
    }

    private function assertTankForShift(FuelTank $tank, FuelShift $shift): void
    {
        if ($tank->fuel_station_id !== $shift->fuel_station_id || $tank->branch_id !== $shift->branch_id || $tank->status !== FuelTank::STATUS_ACTIVE) {
            throw new RuntimeException('الخزان لا ينتمي إلى المحطة أو الفرع النشطين، أو ليس متاحاً تشغيلياً.');
        }
    }

    private function event(FuelShift $shift, string $type, ?User $actor, array $payload): FuelShiftEvent
    {
        return FuelShiftEvent::create([
            'branch_id' => $shift->branch_id,
            'fuel_shift_id' => $shift->id,
            'type' => $type,
            'payload' => $payload,
            'actor_id' => $actor?->id,
            'occurred_at' => now(),
        ]);
    }

    private function requirePermission(User $actor, string $permission): void
    {
        if (! $actor->hasPermission($permission)) {
            throw new RuntimeException('لا تملك صلاحية تنفيذ عملية الشفت المطلوبة.');
        }
    }

    private function stage(mixed $stage): string
    {
        if (! is_string($stage) || ! in_array($stage, FuelShiftMeterReading::STAGES, true)) {
            throw new RuntimeException('مرحلة قراءة الشفت يجب أن تكون opening أو closing.');
        }
        return $stage;
    }

    /** @param array<string,mixed> $attributes */
    private function meterQuantity(array $attributes): int
    {
        if (array_key_exists('meter_milliliters', $attributes)) {
            return $this->nonNegativeInteger($attributes['meter_milliliters'], 'meter_milliliters');
        }
        return $this->quantity->litersToMilliliters($this->requiredString($attributes, 'meter_liters'));
    }

    /** @param array<string,mixed> $attributes */
    private function tankQuantity(array $attributes): int
    {
        if (array_key_exists('quantity_milliliters', $attributes)) {
            return $this->nonNegativeInteger($attributes['quantity_milliliters'], 'quantity_milliliters');
        }
        return $this->quantity->litersToMilliliters($this->requiredString($attributes, 'quantity_liters'));
    }

    /** @param array<string,mixed> $attributes */
    private function requiredString(array $attributes, string $key): string
    {
        $value = $attributes[$key] ?? null;
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("{$key} مطلوب.");
        }
        return trim($value);
    }

    private function positiveInteger(mixed $value, string $key): int
    {
        $number = $this->nonNegativeInteger($value, $key);
        if ($number <= 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً.");
        }
        return $number;
    }

    private function nonNegativeInteger(mixed $value, string $key): int
    {
        if (! is_int($value) && !(is_string($value) && preg_match('/^\d+$/', $value))) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً غير سالب.");
        }
        $number = (int) $value;
        if ($number < 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً غير سالب.");
        }
        return $number;
    }

    /** @return array<int,string> */
    private function terminalKeys(mixed $value): array
    {
        if (! is_array($value)) {
            throw new RuntimeException('الأجهزة/النقاط النشطة يجب أن تكون قائمة مفاتيح نصية.');
        }
        $keys = [];
        foreach ($value as $key) {
            if (! is_string($key) || trim($key) === '') {
                throw new RuntimeException('كل مفتاح جهاز نشط يجب أن يكون نصاً غير فارغ.');
            }
            $keys[] = trim($key);
        }
        return array_values(array_unique($keys));
    }

    private function nullableText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            throw new RuntimeException('الملاحظة يجب أن تكون نصاً.');
        }
        $value = trim($value);
        return $value === '' ? null : $value;
    }
}
