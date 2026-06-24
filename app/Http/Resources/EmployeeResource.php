<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class EmployeeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'employee_no'  => $this->employee_no,
            'name'         => $this->name,
            'national_id'  => $this->national_id,
            'job_title'    => $this->job_title,
            'basic_salary'     => Money::toRiyal($this->basic_salary),
            'allowances'       => Money::toRiyal($this->allowances),
            'gosi'             => Money::toRiyal($this->gosi),
            'other_deductions' => Money::toRiyal($this->other_deductions),
            'gross'            => Money::toRiyal($this->gross()),
            'net'              => Money::toRiyal($this->net()),
            'hire_date'    => optional($this->hire_date)->toDateString(),
            'is_active'    => $this->is_active,
            'notes'        => $this->notes,
        ];
    }
}
