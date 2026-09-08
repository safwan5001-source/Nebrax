<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** FISCAL-2: نطاق مغلق الطرفين وشاملٌ لهما، قد يكون غير تقويمي. */
class StoreFiscalYearRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'       => ['required', 'string', 'max:120'],
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date'   => ['required', 'date_format:Y-m-d'],
        ];
    }
}
