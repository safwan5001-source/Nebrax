<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use App\Support\FuelCostVisibility;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelDeliveryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);
        // FS-23 (B1): تكلفة الشراء تتبع `products.view_cost`؛ `fuel_stations.view` وحدها (صلاحية البائع في التطبيق) لا تكشفها. المفتاح يُحذف كاملاً.
        $canSeeCost = FuelCostVisibility::canSeeCost($request->user());

        return [
            'id' => $this->id,
            // رقم الاستلام الداخلي (≠ رقم سند المورد `delivery_note_number`).
            'reference' => $this->reference(),
            'status' => $this->status,
            'station_id' => $this->fuel_station_id,
            'tank_id' => $this->fuel_tank_id,
            'fuel_product_id' => $this->fuel_product_id,
            'warehouse_id' => $this->warehouse_id,
            'supplier_id' => $this->supplier_id,
            'procurement_order_id' => $this->procurement_order_id,
            'purchase_reference' => $this->purchase_reference,
            'delivery_note_number' => $this->delivery_note_number,
            'dispatched_milliliters' => (int) $this->dispatched_milliliters,
            'dispatched_liters' => $quantity->millilitersToLiters((int) $this->dispatched_milliliters),
            'received_milliliters' => (int) $this->received_milliliters,
            'received_liters' => $quantity->millilitersToLiters((int) $this->received_milliliters),
            'transit_variance_milliliters' => (int) $this->transit_variance_milliliters,
            // FUEL-B5.1: NULL = لم تُسجَّل بعد (لا صفر). حالة «مسجَّلة؟» لا تكشف مبلغاً فتُعرض لكل من يرى الاستلام؛ المبلغ والفاعل لمن يرى التكلفة فقط.
            'cost_recorded' => $this->received_total_cost_minor !== null,
            'received_total_cost_minor' => $this->when($canSeeCost, fn () => $this->received_total_cost_minor === null ? null : (int) $this->received_total_cost_minor),
            'cost_recorded_by' => $this->when($canSeeCost, fn () => $this->cost_recorded_by),
            'cost_recorded_at' => $this->when($canSeeCost, fn () => $this->cost_recorded_at?->toISOString()),
            'attachments_count' => $this->whenCounted('attachments'),
            'attachments' => $this->whenLoaded('attachments', fn () => $this->attachments->map(fn ($a) => [
                'id' => $a->id, 'name' => $a->original_name, 'mime_type' => $a->mime_type, 'size' => (int) $a->size,
                'uploaded_by' => $a->uploaded_by, 'created_at' => $a->created_at?->toISOString(),
            ])->values()->all()),
            'grni_account_id' => $this->grni_account_id,
            'stock_movement_id' => $this->stock_movement_id,
            'journal_entry_id' => $this->journal_entry_id,
            'operational_ledger_id' => $this->fuel_operational_ledger_id,
            // FUEL-B5 (إضافي): ما تحتاجه شاشة الاستلام لتعرض السجل بلا اختلاق — أسماء المراجع المحمَّلة، المنشئ (لتلميح فصل المعتمِد)، بيانات الناقلة، وقراءات الخزان المربوطة.
            'created_by' => $this->created_by,
            'tanker_identifier' => $this->tanker_identifier,
            'driver_name' => $this->driver_name,
            'temperature_milli_celsius' => $this->temperature_milli_celsius,
            'density_kg_per_m3' => $this->density_kg_per_m3,
            'supplier' => $this->whenLoaded('supplier', fn () => $this->supplier ? ['id' => $this->supplier->id, 'name' => $this->supplier->name, 'code' => $this->supplier->code] : null),
            'tank' => $this->whenLoaded('tank', fn () => $this->tank ? ['id' => $this->tank->id, 'code' => $this->tank->code, 'name' => $this->tank->name] : null),
            'warehouse' => $this->whenLoaded('warehouse', fn () => $this->warehouse ? ['id' => $this->warehouse->id, 'name' => $this->warehouse->name, 'code' => $this->warehouse->code] : null),
            'readings' => [
                'before_physical' => $this->readingBlock('beforePhysicalReading'),
                'after_physical' => $this->readingBlock('afterPhysicalReading'),
                'before_atg' => $this->readingBlock('beforeAtgReading'),
                'after_atg' => $this->readingBlock('afterAtgReading'),
            ],
            'received_at' => $this->received_at?->toISOString(),
            'approved_at' => $this->approved_at?->toISOString(),
            'approved_by' => $this->approved_by,
            'evidence' => $this->evidence,
            'notes' => $this->notes,
            'created_at' => $this->created_at?->toISOString(),
        ];
    }

    /** قراءة خزان مربوطة (معرّف + كمية + وقت) أو null؛ تُحمَّل علاقتها في العرض المفرد فقط، وغير المحمَّلة تُعاد بمعرّفها وحده. */
    private function readingBlock(string $relation): ?array
    {
        $idColumn = match ($relation) {
            'beforePhysicalReading' => 'before_physical_reading_id',
            'afterPhysicalReading' => 'after_physical_reading_id',
            'beforeAtgReading' => 'before_atg_reading_id',
            default => 'after_atg_reading_id',
        };
        $id = $this->{$idColumn};
        if ($id === null) {
            return null;
        }
        $reading = $this->relationLoaded($relation) ? $this->{$relation} : null;
        if ($reading === null) {
            return ['id' => $id];
        }

        return [
            'id' => $reading->id,
            'quantity_milliliters' => (int) $reading->quantity_milliliters,
            'quantity_liters' => app(FuelQuantity::class)->millilitersToLiters((int) $reading->quantity_milliliters),
            'measured_at' => $reading->measured_at?->toIso8601String(),
        ];
    }
}
