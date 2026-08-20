<?php

namespace App\Http\Requests;

use App\Models\Contract;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreContractRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type'               => ['required', Rule::in(Contract::TYPES)],
            'status'             => ['nullable', Rule::in(Contract::STATUSES)],
            'start_date'         => ['required', 'date'],
            'end_date'           => ['nullable', 'date', 'after_or_equal:start_date'],
            'probation_end_date' => ['nullable', 'date'],
            'basic_salary'       => ['required', 'integer', 'min:0'], // هللات
            'allowances'         => ['nullable', 'integer', 'min:0'], // هللات
            'gosi'               => ['nullable', 'integer', 'min:0'], // هللات
            'other_deductions'   => ['nullable', 'integer', 'min:0'], // هللات
            'notes'              => ['nullable', 'string'],
        ];
    }
}
