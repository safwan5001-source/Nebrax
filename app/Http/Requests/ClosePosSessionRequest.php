<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ClosePosSessionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'closing_balance' => ['required', 'integer', 'min:0'],
            'payment_counts' => ['sometimes', 'array', 'max:50'],
            'payment_counts.*.payment_method_id' => ['required', 'uuid', 'distinct'],
            'payment_counts.*.counted_amount' => ['required', 'integer', 'min:0'],
            'handover_note' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
