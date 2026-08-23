<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CloseFuelShiftRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'counted_cash_minor' => ['required', 'integer', 'min:0'],
            'closing_note' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
