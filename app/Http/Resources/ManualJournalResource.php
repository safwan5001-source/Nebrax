<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ManualJournalResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'number' => $this->number,
            'branch_id' => $this->branch_id,
            'entry_date' => optional($this->entry_date)->toDateString(),
            'description' => $this->description,
            'status' => $this->status,
            'journal_entry_id' => $this->journal_entry_id,
            'created_by' => $this->created_by,
            'lines' => $this->whenLoaded('lines', fn () => $this->lines->map(fn ($line) => [
                'id' => $line->id,
                'account_id' => $line->account_id,
                'account_code' => $line->relationLoaded('account') ? $line->account?->code : null,
                'account_name' => $line->relationLoaded('account') ? $line->account?->name : null,
                'description' => $line->description,
                'debit' => Money::toRiyal($line->debit),
                'credit' => Money::toRiyal($line->credit),
                'partner_id' => $line->partner_id,
                'cost_center_id' => $line->cost_center_id,
                'cost_center_code' => $line->relationLoaded('costCenter') ? $line->costCenter?->code : null,
                'cost_center_name' => $line->relationLoaded('costCenter') ? $line->costCenter?->name : null,
                'sort_order' => $line->sort_order,
            ])->values()),
        ];
    }
}
