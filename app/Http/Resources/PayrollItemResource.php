<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PayrollItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'employee_id'  => $this->employee_id,
            'employee'     => $this->whenLoaded('employee', fn () => [
                'id'   => $this->employee->id,
                'name' => $this->employee->name,
            ]),
            'basic_salary'     => Money::toRiyal($this->basic_salary),
            'allowances'       => Money::toRiyal($this->allowances),
            'gosi'             => Money::toRiyal($this->gosi),
            'other_deductions' => Money::toRiyal($this->other_deductions),
            'gross'            => Money::toRiyal($this->gross),
            'net'              => Money::toRiyal($this->net),
        ];
    }
}
