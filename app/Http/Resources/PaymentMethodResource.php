<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PaymentMethodResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'name_en' => $this->name_en,
            'settlement_type' => $this->settlement_type,
            'cash_bank_account_id' => $this->cash_bank_account_id,
            'cash_bank_account_name' => $this->cashBankAccount?->name,
            'cash_account_id' => $this->cashBankAccount?->account_id,
            'instructions' => $this->instructions,
            'available_online' => $this->available_online,
            'is_active' => $this->is_active,
            'is_default' => $this->is_default,
            'fees_enabled' => $this->fees_enabled,
            'fee_rate_bps' => $this->fee_rate_bps,
            'fee_fixed_amount' => Money::toRiyal($this->fee_fixed_amount),
            'fee_min_amount' => Money::toRiyal($this->fee_min_amount),
            'fee_tax_rate' => $this->fee_tax_rate,
            'fee_expense_account_id' => $this->fee_expense_account_id,
            'fee_expense_account_name' => $this->feeExpenseAccount?->name,
            'payments_count' => $this->when(isset($this->payments_count), $this->payments_count),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
