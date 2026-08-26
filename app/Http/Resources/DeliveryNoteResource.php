<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DeliveryNoteResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'number' => $this->number,
            'status' => $this->status,
            'version' => (int) $this->version,
            'external_reference' => $this->external_reference,
            'delivery_date' => $this->delivery_date?->toDateString(),
            'notes' => $this->notes,
            'customer_id' => $this->customer_id,
            'customer' => $this->whenLoaded('customer', fn () => $this->customer ? [
                'id' => $this->customer->id,
                'name' => $this->customer->name,
                'type' => $this->customer->type,
            ] : null),
            'warehouse_id' => $this->warehouse_id,
            'warehouse' => $this->whenLoaded('warehouse', fn () => $this->warehouse ? [
                'id' => $this->warehouse->id,
                'name' => $this->warehouse->name,
                'code' => $this->warehouse->code,
            ] : null),
            'created_by' => $this->created_by,
            'confirmed_by' => $this->confirmed_by,
            'confirmed_at' => $this->confirmed_at?->toIso8601String(),
            'cancelled_by' => $this->cancelled_by,
            'cancelled_at' => $this->cancelled_at?->toIso8601String(),
            'cancellation_reason' => $this->cancellation_reason,
            'lines' => $this->whenLoaded('lines', fn () => $this->lines->map(fn ($line) => [
                'id' => $line->id,
                'line_number' => (int) $line->line_number,
                'product_id' => $line->product_id,
                'product_name' => $line->product_name_snapshot,
                'product_sku' => $line->product_sku_snapshot,
                'product_barcode' => $line->product_barcode_snapshot,
                'unit_name' => $line->unit_name,
                'unit_factor' => (int) $line->unit_factor,
                'quantity' => (int) $line->quantity,
                'quantity_numerator' => $line->quantity_numerator === null ? null : (int) $line->quantity_numerator,
                'quantity_denominator' => $line->quantity_denominator === null ? null : (int) $line->quantity_denominator,
                'description' => $line->description,
            ])->values()),
            'events' => $this->whenLoaded('events', fn () => $this->events->map(fn ($event) => [
                'id' => $event->id,
                'event' => $event->event,
                'from_status' => $event->from_status,
                'to_status' => $event->to_status,
                'actor_id' => $event->actor_id,
                'actor_name' => $event->relationLoaded('actor') ? $event->actor?->name : null,
                'reason' => $event->reason,
                'metadata' => $event->metadata,
                'occurred_at' => $event->occurred_at?->toIso8601String(),
            ])->values()),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
