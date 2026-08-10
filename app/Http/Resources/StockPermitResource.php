<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StockPermitResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                  => $this->id,
            'type'                => $this->type,
            'number'              => $this->number,
            'warehouse_id'        => $this->warehouse_id,
            'warehouse_name'      => $this->whenLoaded('warehouse', fn () => $this->warehouse?->name),
            'target_warehouse_id' => $this->target_warehouse_id,
            'target_warehouse_name' => $this->whenLoaded('targetWarehouse', fn () => $this->targetWarehouse?->name),
            'permit_date'         => optional($this->permit_date)->toDateString(),
            'status'              => $this->status,
            'reason'              => $this->reason,
            'notes'               => $this->notes,
            'total_cost'          => Money::toRiyal($this->total_cost),
            'journal_entry_id'    => $this->journal_entry_id,
            'lines'               => StockPermitLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}
