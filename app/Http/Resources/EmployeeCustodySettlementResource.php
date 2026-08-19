<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class EmployeeCustodySettlementResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'number' => $this->number,
            'employee_custody_id' => $this->employee_custody_id,
            'settlement_type_id' => $this->settlement_type_id,
            'settlement_type_name' => $this->whenLoaded('settlementType', fn () => $this->settlementType?->name),
            'debit_account_id' => $this->debit_account_id,
            'debit_account_code' => $this->whenLoaded('debitAccount', fn () => $this->debitAccount?->code),
            'debit_account_name' => $this->whenLoaded('debitAccount', fn () => $this->debitAccount?->name),
            'settlement_date' => optional($this->settlement_date)->toDateString(),
            'amount' => Money::toRiyal($this->amount),
            'notes' => $this->notes,
            'journal_entry_id' => $this->journal_entry_id,
            'created_at' => optional($this->created_at)->toISOString(),
        ];
    }
}
