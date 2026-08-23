<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelShiftCashMovementRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'type' => ['required', 'in:cash_in,cash_out,expense'],
            'amount_minor' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'max:2000'],
            'evidence' => ['nullable', 'array'],
            'idempotency_key' => ['required', 'string', 'max:128'],
            'recorded_at' => ['nullable', 'date'],
        ];
    }
}
