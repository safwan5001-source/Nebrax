<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreEmployeeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_no'  => ['nullable', 'string', 'max:255'],
            'name'         => ['required', 'string', 'max:255'],
            'national_id'  => ['nullable', 'string', 'max:255'],
            'job_title'    => ['nullable', 'string', 'max:255'],
            'basic_salary' => ['required', 'integer', 'min:0'], // هللات
            'allowances'   => ['nullable', 'integer', 'min:0'], // هللات
            'hire_date'    => ['nullable', 'date'],
            'is_active'    => ['boolean'],
            'notes'        => ['nullable', 'string'],
        ];
    }
}
