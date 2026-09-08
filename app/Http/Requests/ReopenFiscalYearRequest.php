<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** FISCAL-2: فتح سنة مالية يوجب سبباً — هو الأثر التدقيقي الباقي بعد رفع الإقفال. */
class ReopenFiscalYearRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'max:1000'],
        ];
    }
}
