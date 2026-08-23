<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreCorporateFuelContractPriceRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_product_id' => ['required', 'uuid'],
            'price_per_liter_minor' => ['required', 'integer', 'min:1'],
            'tax_mode' => ['required', 'in:tax_inclusive,tax_exclusive'],
            'effective_from' => ['required', 'date'],
            'effective_until' => ['nullable', 'date', 'after:effective_from'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
