<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class EmployeeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // الراتب يتبع العقد النشط اليوم، لا حقول الموظف الثابتة القديمة
        // (design-system/foundations/hr-users-architecture.md «الراتب يتبع العقد»).
        $contract = $this->activeContract();

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
            'job_title_id'      => $this->job_title_id,
            'job_title'         => $this->whenLoaded('jobTitle', fn () => $this->jobTitle ? [
                'id' => $this->jobTitle->id, 'name' => $this->jobTitle->name,
            ] : null),
            'department_id'     => $this->department_id,
            'department'        => $this->whenLoaded('department', fn () => $this->department ? [
                'id' => $this->department->id, 'name' => $this->department->name,
            ] : null),
            'job_level_id'      => $this->job_level_id,
            'job_level'         => $this->whenLoaded('jobLevel', fn () => $this->jobLevel ? [
                'id' => $this->jobLevel->id, 'name' => $this->jobLevel->name,
            ] : null),
            'employment_type_id' => $this->employment_type_id,
            'employment_type'    => $this->whenLoaded('employmentType', fn () => $this->employmentType ? [
                'id' => $this->employmentType->id, 'name' => $this->employmentType->name,
            ] : null),
            'manager_id'     => $this->manager_id,
            'manager'        => $this->whenLoaded('manager', fn () => $this->manager ? [
                'id' => $this->manager->id, 'name' => $this->manager->name,
            ] : null),
            'shift_id'       => $this->shift_id,
            'has_photo'      => (bool) $this->photo_path,
            'current_address'      => $this->current_address,
            'current_city'         => $this->current_city,
            'current_building_no'  => $this->current_building_no,
            'current_street'       => $this->current_street,
            'current_district'     => $this->current_district,
            'current_postal_code'  => $this->current_postal_code,
            'current_country'      => $this->current_country,
            'permanent_address'      => $this->permanent_address,
            'permanent_city'         => $this->permanent_city,
            'permanent_building_no'  => $this->permanent_building_no,
            'permanent_street'       => $this->permanent_street,
            'permanent_district'     => $this->permanent_district,
            'permanent_postal_code'  => $this->permanent_postal_code,
            'permanent_country'      => $this->permanent_country,
            'active_contract_id' => $contract?->id,
            'basic_salary'       => Money::toRiyal($contract?->basic_salary ?? 0),
            'allowances'         => Money::toRiyal($contract?->allowances ?? 0),
            'gosi'               => Money::toRiyal($contract?->gosi ?? 0),
            'other_deductions'   => Money::toRiyal($contract?->other_deductions ?? 0),
            'gross'              => Money::toRiyal($contract?->gross() ?? 0),
            'net'                => Money::toRiyal($contract?->net() ?? 0),
            'hire_date'    => optional($this->hire_date)->toDateString(),
            'is_active'    => $this->is_active,
            'notes'        => $this->notes,
        ];
    }
}
