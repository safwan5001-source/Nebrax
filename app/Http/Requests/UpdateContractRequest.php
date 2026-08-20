<?php

namespace App\Http\Requests;

use App\Models\Contract;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateContractRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type'               => ['sometimes', Rule::in(Contract::TYPES)],
            'status'             => ['sometimes', Rule::in(Contract::STATUSES)],
            'start_date'         => ['sometimes', 'date'],
            // مقارنة after_or_equal:start_date تُترك للمتحكّم عند التحديث الجزئي —
            // start_date قد لا يصل في هذا الطلب فتُقارَن بقيمة السجلّ الحالية لا المُدخلة.
            'end_date'           => ['nullable', 'date'],
            'probation_end_date' => ['nullable', 'date'],
            'basic_salary'       => ['sometimes', 'integer', 'min:0'], // هللات
            'allowances'         => ['nullable', 'integer', 'min:0'], // هللات
            'gosi'               => ['nullable', 'integer', 'min:0'], // هللات
            'other_deductions'   => ['nullable', 'integer', 'min:0'], // هللات
            'notes'              => ['nullable', 'string'],
        ];
    }
}
