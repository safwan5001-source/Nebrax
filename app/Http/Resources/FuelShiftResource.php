<?php

namespace App\Http\Resources;

use App\Models\FuelShiftEvent;
use App\Services\FuelQuantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * لقطة الشفت التشغيلية. لا تحوّل عدادات الشفت أو حركاته النقدية إلى مبيعات أو
 * دفعات رسمية؛ تلك العلاقات مؤجلة صراحةً إلى Cycle 5.
 *
 * #2016 / D8: مبالغ مبيعات الوقود وتحصيلها تتطلب `fuel.sale.view` ولو مرّت عبر `fuel.shift.view`:
 *  - حدث «تحصيل نقد رسمي» (مبلغ + معرّف بيع/سند) لا يظهر في الخط الزمني لمن لا يملكها.
 *  - الحقول المالية القديمة (`expected_operational_cash_minor`، `cash_variance_minor`، `cash_variance.*`، حمولات أحداث
 *    الإغلاق/الفرق) تبقى كما هي ما دامت بوابة #2021 مغلقة (قيمها تشغيلية بلا نقد مبيعات). عند فتح
 *    `fuel_stations.shift_cash_receipts_enabled` يدخل نقد المبيعات في «المتوقع» نفسه، فتُخفى (null) عمّن لا يملك
 *    `fuel.sale.view`. الفشل مغلق: بلا مستخدم = بلا صلاحية.
 */
class FuelShiftResource extends JsonResource
{
    /** @var array<string,mixed>|null #2021: ملخص النقد المتوقع/المعدود/الفرق من `FuelShiftCashExpectationService` (للعرض فرداً فقط). */
    private ?array $cashSummary = null;

    /** @param array<string,mixed> $summary */
    public function withCashSummary(array $summary): static
    {
        $this->cashSummary = $summary;

        return $this;
    }

    /** حمولة حدث/تصحيح تحمل الفرق أو المتوقع (تُحذف مفاتيحها عند إخفاء المشتق من المبيعات). */
    private const SALE_DERIVED_CASH_KEYS = ['expected_operational_cash_minor', 'cash_variance_minor', 'variance_minor', 'direction', 'variance_direction'];

    private function canViewSales(Request $request): bool
    {
        return $request->user()?->hasPermission('fuel.sale.view') ?? false;
    }

    /** هل تُحجب الحقول المالية القديمة (المتوقع/الفرق) عن هذا العارض؟ */
    private function hidesSaleDerivedCash(Request $request): bool
    {
        return (bool) config('fuel_stations.shift_cash_receipts_enabled', false) && ! $this->canViewSales($request);
    }

    /** @param array<string,mixed>|null $payload @return array<string,mixed>|null */
    private function redactCashKeys(?array $payload, bool $hide): ?array
    {
        return $hide && $payload !== null ? array_diff_key($payload, array_flip(self::SALE_DERIVED_CASH_KEYS)) : $payload;
    }

    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);
        $hideCash = $this->hidesSaleDerivedCash($request);
        $canViewSales = $this->canViewSales($request);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status,
            'branch_id' => $this->branch_id,
            'station_id' => $this->fuel_station_id,
            'opening_float_minor' => (int) $this->opening_float_minor,
            'counted_cash_minor' => $this->counted_cash_minor === null ? null : (int) $this->counted_cash_minor,
            'expected_operational_cash_minor' => $hideCash || $this->expected_operational_cash_minor === null ? null : (int) $this->expected_operational_cash_minor,
            'cash_variance_minor' => $hideCash || $this->cash_variance_minor === null ? null : (int) $this->cash_variance_minor,
            'operational_meter_milliliters' => (int) $this->operational_meter_milliliters,
            'operational_liters' => $quantity->millilitersToLiters((int) $this->operational_meter_milliliters),
            'operational_delivery_milliliters' => (int) $this->operational_delivery_milliliters,
            'operational_tank_variance_milliliters' => $this->operational_tank_variance_milliliters === null ? null : (int) $this->operational_tank_variance_milliliters,
            'active_terminal_keys' => $this->active_terminal_keys ?? [],
            'opening_note' => $this->opening_note,
            'closing_note' => $this->closing_note,
            'opened_by' => $this->opened_by,
            'closed_by' => $this->closed_by,
            'approved_by' => $this->approved_by,
            'opened_at' => $this->opened_at?->toISOString(),
            'closed_at' => $this->closed_at?->toISOString(),
            'approved_at' => $this->approved_at?->toISOString(),
            'locked_at' => $this->locked_at?->toISOString(),
            'cash_summary' => $this->when($this->cashSummary !== null, fn () => $this->cashSummary),
            'cash_variance' => $this->whenLoaded('cashVariance', fn () => $this->cashVariance === null ? null : [
                'id' => $this->cashVariance->id,
                'status' => $this->cashVariance->status,
                'variance_direction' => $hideCash ? null : $this->cashVariance->variance_direction,
                'expected_operational_cash_minor' => $hideCash ? null : (int) $this->cashVariance->expected_operational_cash_minor,
                'counted_cash_minor' => (int) $this->cashVariance->counted_cash_minor,
                'variance_minor' => $hideCash ? null : (int) $this->cashVariance->variance_minor,
                'note' => $this->cashVariance->note,
                'counted_by' => $this->cashVariance->counted_by,
                'counted_at' => $this->cashVariance->counted_at?->toISOString(),
                'reviewed_by' => $this->cashVariance->reviewed_by,
                'reviewed_at' => $this->cashVariance->reviewed_at?->toISOString(),
            ]),
            'staff_assignments' => $this->whenLoaded('staffAssignments', fn () => $this->staffAssignments->map(fn ($assignment) => [
                'id' => $assignment->id,
                'user_id' => $assignment->user_id,
                'role' => $assignment->role,
                'assigned_by' => $assignment->assigned_by,
                'assigned_at' => $assignment->assigned_at?->toISOString(),
            ])->values()),
            'meter_readings' => $this->whenLoaded('meterReadings', fn () => $this->meterReadings->map(fn ($reading) => [
                'id' => $reading->id,
                'nozzle_id' => $reading->fuel_nozzle_id,
                'reading_stage' => $reading->reading_stage,
                'meter_milliliters' => (int) $reading->meter_milliliters,
                'meter_liters' => $quantity->millilitersToLiters((int) $reading->meter_milliliters),
                'evidence_key' => $reading->evidence_key,
                'evidence' => $reading->evidence,
                'recorded_by' => $reading->recorded_by,
                'measured_at' => $reading->measured_at?->toISOString(),
            ])->values()),
            'tank_readings' => $this->whenLoaded('tankReadings', fn () => $this->tankReadings->map(fn ($reading) => [
                'id' => $reading->id,
                'tank_id' => $reading->fuel_tank_id,
                'reading_stage' => $reading->reading_stage,
                'reading_type' => $reading->reading_type,
                'quantity_milliliters' => (int) $reading->quantity_milliliters,
                'quantity_liters' => $quantity->millilitersToLiters((int) $reading->quantity_milliliters),
                'evidence_key' => $reading->evidence_key,
                'evidence' => $reading->evidence,
                'recorded_by' => $reading->recorded_by,
                'measured_at' => $reading->measured_at?->toISOString(),
            ])->values()),
            'cash_movements' => $this->whenLoaded('cashMovements', fn () => $this->cashMovements->map(fn ($movement) => [
                'id' => $movement->id,
                'type' => $movement->type,
                'amount_minor' => (int) $movement->amount_minor,
                'reason' => $movement->reason,
                'evidence' => $movement->evidence,
                'recorded_by' => $movement->recorded_by,
                'recorded_at' => $movement->recorded_at?->toISOString(),
            ])->values()),
            'events' => $this->whenLoaded('events', fn () => $this->events
                // D8: تحصيل المبيعات (مبلغ + بيع + سند) لا يظهر بلا fuel.sale.view.
                ->reject(fn ($event) => ! $canViewSales && in_array($event->type, [FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED, FuelShiftEvent::TYPE_POST_CLOSE_CASH_ADJUSTMENT], true))
                ->map(fn ($event) => [
                    'id' => $event->id,
                    'type' => $event->type,
                    'payload' => $this->redactCashKeys($event->payload, $hideCash),
                    'actor_id' => $event->actor_id,
                    'occurred_at' => $event->occurred_at?->toISOString(),
                ])->values()),
            'corrections' => $this->whenLoaded('corrections', fn () => $this->corrections->map(fn ($correction) => [
                'id' => $correction->id,
                'target_type' => $correction->target_type,
                'target_id' => $correction->target_id,
                'before' => $this->redactCashKeys($correction->before, $hideCash),
                'proposed' => $this->redactCashKeys($correction->proposed, $hideCash),
                'status' => $correction->status,
                'reason' => $correction->reason,
                'requested_by' => $correction->requested_by,
                'requested_at' => $correction->requested_at?->toISOString(),
                'reviewed_by' => $correction->reviewed_by,
                'reviewed_at' => $correction->reviewed_at?->toISOString(),
            ])->values()),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
