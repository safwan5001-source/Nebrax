<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** FISCAL-2: تعديل سنة مالية — الحدود تُرفض لاحقاً في الخدمة إن كان للسنة سجل إقفال. */
class UpdateFiscalYearRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'       => ['sometimes', 'string', 'max:120'],
            'start_date' => ['sometimes', 'date_format:Y-m-d'],
            'end_date'   => ['sometimes', 'date_format:Y-m-d'],
        ];
    }
}
