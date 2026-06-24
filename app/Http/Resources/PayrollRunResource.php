<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PayrollRunResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'number'       => $this->number,
            'period'       => $this->period,
            'period_start' => optional($this->period_start)->toDateString(),
            'period_end'   => optional($this->period_end)->toDateString(),
            'status'       => $this->status,
            'pay_method'   => $this->pay_method,
            'total_gross'            => Money::toRiyal($this->total_gross),
            'total_gosi'             => Money::toRiyal($this->total_gosi),
            'total_other_deductions' => Money::toRiyal($this->total_other_deductions),
            'total_deductions'       => Money::toRiyal($this->totalDeductions()),
            'total_net'              => Money::toRiyal($this->total_net),
            'notes'        => $this->notes,
            'posted_at'    => optional($this->posted_at)->toIso8601String(),
            'paid_at'      => optional($this->paid_at)->toIso8601String(),
            'items'        => PayrollItemResource::collection($this->whenLoaded('items')),
        ];
    }
}
