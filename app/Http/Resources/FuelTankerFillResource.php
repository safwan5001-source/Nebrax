<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * TANKER-PR4: سند تعبئة صهريج. الكمية بالمللتر الصحيح مع نصّ اللترات للعرض (بلا float). `number` الرقم الإلكتروني (FTF) و`voucher_number` السند الورقي — حقلان منفصلان.
 * لا مبالغ ولا تكلفة ولا حسابات؛ `inventory_status` يعلن أن السند لم يُدمج مخزنياً. لا `tenant_id` ولا `request_fingerprint`/`idempotency_key`.
 */
class FuelTankerFillResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'voucher_number' => $this->voucher_number,
            'status' => $this->status,
            'inventory_status' => $this->inventory_status,
            'fuel_station_id' => $this->fuel_station_id,
            'fuel_shift_id' => $this->fuel_shift_id,
            'fuel_pump_id' => $this->fuel_pump_id,
            'fuel_nozzle_id' => $this->fuel_nozzle_id,
            'fuel_tank_id' => $this->fuel_tank_id,
            'fuel_product_id' => $this->fuel_product_id,
            'fuel_tanker_owner_id' => $this->fuel_tanker_owner_id,
            'fuel_tanker_id' => $this->fuel_tanker_id,
            'quantity_milliliters' => $this->quantity_milliliters,
            'quantity_liters' => $quantity->millilitersToLiters((int) $this->quantity_milliliters),
            'tanker_capacity_milliliters' => $this->tanker_capacity_milliliters,
            'capacity_overrun_milliliters' => $this->capacity_overrun_milliliters,
            'capacity_overrun_policy' => $this->capacity_overrun_policy,
            'capacity_overrun_confirmed_by' => $this->capacity_overrun_confirmed_by,
            'capacity_overrun_confirmed_at' => $this->capacity_overrun_confirmed_at?->toIso8601String(),
            'voucher_scope' => $this->voucher_scope,
            'policy_snapshot' => $this->policy_snapshot,
            'notes' => $this->notes,
            'recorded_by' => $this->recorded_by,
            'recorded_at' => $this->recorded_at?->toIso8601String(),
            'voided_by' => $this->voided_by,
            'voided_at' => $this->voided_at?->toIso8601String(),
            'void_reason' => $this->void_reason,
            'owner' => $this->whenLoaded('owner', fn () => ['id' => $this->owner->id, 'name' => $this->owner->name, 'code' => $this->owner->code]),
            'tanker' => $this->whenLoaded('tanker', fn () => $this->tanker === null ? null : [
                'id' => $this->tanker->id, 'plate_number' => $this->tanker->plate_number, 'capacity_milliliters' => $this->tanker->capacity_milliliters,
            ]),
            // TANKER-PR5: عدد المرفقات النشطة (يظهر حين يحمّله المتحكّم). الدليل فقط — لا يغيّر حالة السند.
            'attachments_count' => $this->when(isset($this->active_attachments_count), fn () => (int) $this->active_attachments_count),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
