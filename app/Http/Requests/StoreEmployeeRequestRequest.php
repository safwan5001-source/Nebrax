<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** طلبٌ عامٌّ لموظف (سلفة/استئذان/شكوى...) — انظر App\Models\EmployeeRequest. */
class StoreEmployeeRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'request_type_id' => ['required', 'uuid'],
            'title'           => ['required', 'string', 'max:255'],
            'description'     => ['nullable', 'string'],
            'requested_date'  => ['nullable', 'date'],
        ];
    }
}
