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
            'branch_id'    => $this->branch_id,   // مكان العمل (وصفي)
            'employee_no'  => $this->employee_no,
            'name'         => $this->name,
            'first_name'   => $this->first_name,
            'middle_name'  => $this->middle_name,
            'last_name'    => $this->last_name,
            'national_id'  => $this->national_id,
            'nationality'  => $this->nationality,
            'residency_expiry_date' => optional($this->residency_expiry_date)->toDateString(),
            'phone'          => $this->phone,
            'personal_email' => $this->personal_email,
            'job_title'      => $this->job_title,
            'department'     => $this->department,
            'employment_type' => $this->employment_type,
            'manager_id'     => $this->manager_id,
            'manager'        => $this->whenLoaded('manager', fn () => $this->manager ? [
                'id' => $this->manager->id, 'name' => $this->manager->name,
            ] : null),
            'shift_id'       => $this->shift_id,
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
