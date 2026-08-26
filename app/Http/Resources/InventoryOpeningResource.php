<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InventoryOpeningResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'               => $this->id,
            'number'           => $this->number,
            'opening_date'     => optional($this->opening_date)->toDateString(),
            'status'           => $this->status,
            'notes'            => $this->notes,
            'source_filename'  => $this->source_filename,
            'total_quantity'   => $this->total_quantity,
            'total_value'      => Money::toRiyal($this->total_value),
            'journal_entry_id' => $this->journal_entry_id,
            'posted_at'        => $this->posted_at?->toIso8601String(),
            'lines_count'      => $this->whenCounted('lines'),
            'lines'            => InventoryOpeningLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}
