<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateEmployeeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_no'  => ['sometimes', 'string', 'max:255'],
            'name'         => ['sometimes', 'string', 'max:255'],
            'national_id'  => ['nullable', 'string', 'max:255'],
            'job_title'    => ['nullable', 'string', 'max:255'],
            'basic_salary'     => ['sometimes', 'integer', 'min:0'],
            'allowances'       => ['nullable', 'integer', 'min:0'],
            'gosi'             => ['nullable', 'integer', 'min:0'],
            'other_deductions' => ['nullable', 'integer', 'min:0'],
            'hire_date'    => ['nullable', 'date'],
            'is_active'    => ['boolean'],
            'notes'        => ['nullable', 'string'],
        ];
    }
}
