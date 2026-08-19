<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class EmployeeCustodyResource extends JsonResource
{
    public function toArray(Request $request): array
    {
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
            'status' => $this->status,
            'notes' => $this->notes,
            'journal_entry_id' => $this->journal_entry_id,
        ];
    }
}
