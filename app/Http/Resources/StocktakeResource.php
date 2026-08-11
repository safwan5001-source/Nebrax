<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StocktakeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'               => $this->id,
            'number'           => $this->number,
            'warehouse_id'     => $this->warehouse_id,
            'warehouse_name'   => $this->whenLoaded('warehouse', fn () => $this->warehouse?->name),
            'stocktake_date'   => optional($this->stocktake_date)->toDateString(),
            'status'           => $this->status,
            'notes'            => $this->notes,
            'difference_value' => Money::toRiyal($this->difference_value),
            'journal_entry_id' => $this->journal_entry_id,
            'lines'            => StocktakeLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}
