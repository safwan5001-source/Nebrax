<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * لقطة الشفت التشغيلية. لا تحوّل عدادات الشفت أو حركاته النقدية إلى مبيعات أو
 * دفعات رسمية؛ تلك العلاقات مؤجلة صراحةً إلى Cycle 5.
 */
class FuelShiftResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status,
            'branch_id' => $this->branch_id,
            'station_id' => $this->fuel_station_id,
            'opening_float_minor' => (int) $this->opening_float_minor,
            'counted_cash_minor' => $this->counted_cash_minor === null ? null : (int) $this->counted_cash_minor,
            'expected_operational_cash_minor' => $this->expected_operational_cash_minor === null ? null : (int) $this->expected_operational_cash_minor,
            'cash_variance_minor' => $this->cash_variance_minor === null ? null : (int) $this->cash_variance_minor,
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
            'cash_variance' => $this->whenLoaded('cashVariance', fn () => $this->cashVariance === null ? null : [
                'id' => $this->cashVariance->id,
                'status' => $this->cashVariance->status,
                'variance_direction' => $this->cashVariance->variance_direction,
                'expected_operational_cash_minor' => (int) $this->cashVariance->expected_operational_cash_minor,
                'counted_cash_minor' => (int) $this->cashVariance->counted_cash_minor,
                'variance_minor' => (int) $this->cashVariance->variance_minor,
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
            'events' => $this->whenLoaded('events', fn () => $this->events->map(fn ($event) => [
                'id' => $event->id,
                'type' => $event->type,
                'payload' => $event->payload,
                'actor_id' => $event->actor_id,
                'occurred_at' => $event->occurred_at?->toISOString(),
            ])->values()),
            'corrections' => $this->whenLoaded('corrections', fn () => $this->corrections->map(fn ($correction) => [
                'id' => $correction->id,
                'target_type' => $correction->target_type,
                'target_id' => $correction->target_id,
                'before' => $correction->before,
                'proposed' => $correction->proposed,
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
