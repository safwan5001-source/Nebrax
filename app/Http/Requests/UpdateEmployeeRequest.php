<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateEmployeeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_merge([
            'branch_id'    => ['nullable', 'uuid'], // مكان العمل (وصفي — لا يعزل)
            'employee_no'  => ['sometimes', 'string', 'max:255'],
            'name'         => ['sometimes', 'string', 'max:255'],
            'first_name'   => ['nullable', 'string', 'max:255'],
            'middle_name'  => ['nullable', 'string', 'max:255'],
            'last_name'    => ['nullable', 'string', 'max:255'],
            'national_id'  => ['nullable', 'string', 'max:255'],
            'nationality'  => ['nullable', 'string', 'max:255'],
            'residency_expiry_date' => ['nullable', 'date'],
            'phone'          => ['nullable', 'string', 'max:255'],
            'personal_email' => ['nullable', 'email', 'max:255'],
            'job_title'      => ['nullable', 'string', 'max:255'],
            'department'     => ['nullable', 'string', 'max:255'],
            'employment_type' => ['nullable', Rule::in(['full_time', 'part_time', 'contract', 'temporary'])],
            'manager_id'   => ['nullable', 'uuid'],
            'shift_id'     => ['nullable', 'uuid'],
            'basic_salary'     => ['sometimes', 'integer', 'min:0'],
            'allowances'       => ['nullable', 'integer', 'min:0'],
            'gosi'             => ['nullable', 'integer', 'min:0'],
            'other_deductions' => ['nullable', 'integer', 'min:0'],
            'hire_date'    => ['nullable', 'date'],
            'is_active'    => ['boolean'],
            'notes'        => ['nullable', 'string'],
        ], StoreEmployeeRequest::addressRules());
    }
}
