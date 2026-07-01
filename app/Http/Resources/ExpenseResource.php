<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ExpenseResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'number'         => $this->number,
            'account_id'     => $this->account_id,
            'account_code'   => $this->whenLoaded('account', fn () => $this->account->code),
            'account_name'   => $this->whenLoaded('account', fn () => $this->account->name),
            'partner_id'     => $this->partner_id,
            'cost_center_id' => $this->cost_center_id,
            'expense_date'   => optional($this->expense_date)->toDateString(),
            'payment_method' => $this->payment_method,
            'description'    => $this->description,
            'amount'         => Money::toRiyal($this->amount),
            'tax_rate'       => $this->tax_rate,
            'tax_amount'     => Money::toRiyal($this->tax_amount),
            'total'          => Money::toRiyal($this->total),
            'status'         => $this->status,
        ];
    }
}
