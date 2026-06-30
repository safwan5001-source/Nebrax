<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AssetResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                       => $this->id,
            'number'                   => $this->number,
            'name'                     => $this->name,
            'account_id'               => $this->account_id,
            'account_code'             => $this->whenLoaded('account', fn () => $this->account->code),
            'account_name'             => $this->whenLoaded('account', fn () => $this->account->name),
            'partner_id'               => $this->partner_id,
            'acquisition_date'         => optional($this->acquisition_date)->toDateString(),
            'payment_method'           => $this->payment_method,
            'cost'                     => Money::toRiyal($this->cost),
            'tax_rate'                 => $this->tax_rate,
            'tax_amount'               => Money::toRiyal($this->tax_amount),
            'total'                    => Money::toRiyal($this->total),
            'salvage_value'            => Money::toRiyal($this->salvage_value),
            'useful_life_months'       => $this->useful_life_months,
            'accumulated_depreciation' => Money::toRiyal($this->accumulated_depreciation),
            'book_value'               => Money::toRiyal($this->bookValue()),
            'status'                   => $this->status,
        ];
    }
}
