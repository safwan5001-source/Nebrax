<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePosHeldSaleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'pos_session_id' => ['required', 'uuid'],
            'cart_id' => ['nullable', 'uuid'],
            'customer_id' => ['nullable', 'uuid'],
            'tax_inclusive' => ['nullable', 'boolean'],
            'items' => ['required', 'array', 'min:1', 'max:500'],
            'items.*.product_id' => ['nullable', 'uuid'],
            'items.*.description' => ['nullable', 'string', 'max:1000'],
            'items.*.sku' => ['nullable', 'string', 'max:255'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit' => ['nullable', 'string', 'max:100'],
            'items.*.unit_price' => ['required', 'integer', 'min:0', 'max:100000000000'],
            'items.*.tax_rate' => ['nullable', 'integer', 'min:0', 'max:100'],
            'items.*.discount' => ['nullable', 'integer', 'min:0', 'max:100000000000'],
        ];
    }
}
