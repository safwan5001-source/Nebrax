<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class EmployeeCustodyResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $settledAmount = $this->settledAmount();
        $remainingAmount = max(0, (int) $this->amount - $settledAmount);

        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'number' => $this->number,
            'employee_id' => $this->employee_id,
            'employee_name' => $this->whenLoaded('employee', fn () => $this->employee?->name),
            'employee_no' => $this->whenLoaded('employee', fn () => $this->employee?->employee_no),
            'custody_account_id' => $this->custody_account_id,
            'custody_account_code' => $this->whenLoaded('custodyAccount', fn () => $this->custodyAccount?->code),
            'custody_account_name' => $this->whenLoaded('custodyAccount', fn () => $this->custodyAccount?->name),
            'cash_account_id' => $this->cash_account_id,
            'cash_account_code' => $this->whenLoaded('cashAccount', fn () => $this->cashAccount?->code),
            'cash_account_name' => $this->whenLoaded('cashAccount', fn () => $this->cashAccount?->name),
            'method' => $this->method,
            'custody_date' => optional($this->custody_date)->toDateString(),
            'due_date' => optional($this->due_date)->toDateString(),
            'amount' => Money::toRiyal($this->amount),
            'settled_amount' => Money::toRiyal($settledAmount),
            'remaining_amount' => Money::toRiyal($remainingAmount),
            'is_settled' => $this->status === 'posted' && $remainingAmount === 0,
            'settlements_count' => $this->whenCounted('settlements'),
            'settlements' => $this->whenLoaded('settlements', fn () => EmployeeCustodySettlementResource::collection($this->settlements)),
            'status' => $this->status,
            'notes' => $this->notes,
            'journal_entry_id' => $this->journal_entry_id,
        ];
    }

    /** مجموع محفوظ بوحدة الهللة، من aggregate المحمّل أو من علاقة التفاصيل. */
    private function settledAmount(): int
    {
        if (array_key_exists('settlements_sum_amount', $this->resource->getAttributes())) {
            return (int) ($this->settlements_sum_amount ?? 0);
        }

        return $this->resource->relationLoaded('settlements')
            ? (int) $this->settlements->sum('amount')
            : 0;
    }
}
