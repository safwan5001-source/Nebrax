<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CashBankAccountResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $account = $this->relationLoaded('account') ? $this->account : null;
        $balance = $account?->relationLoaded('balance') ? $account->balance?->balance : null;

        return [
            'id' => $this->id,
            'account_id' => $this->account_id,
            'account_code' => $account?->code,
            'account_name' => $account?->name,
            'type' => $this->type,
            'name' => $this->name,
            'bank_name' => $this->bank_name,
            'account_number' => $this->account_number,
            'currency' => $this->currency,
            'description' => $this->description,
            'is_active' => $this->is_active,
            'is_main' => $this->is_main,
            'balance' => Money::toRiyal($balance ?? 0),
            'deposit_scope' => $this->deposit_scope,
            'deposit_scope_subject' => $this->deposit_scope_subject,
            'withdraw_scope' => $this->withdraw_scope,
            'withdraw_scope_subject' => $this->withdraw_scope_subject,
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
