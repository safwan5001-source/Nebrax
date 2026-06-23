<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePayrollRunRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'period'         => ['required', 'string', 'regex:/^\d{4}-\d{2}$/'], // YYYY-MM
            'notes'          => ['nullable', 'string'],
            'employee_ids'   => ['nullable', 'array'],
            'employee_ids.*' => ['uuid'],
        ];
    }
}
