<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CollectFuelSalePaymentRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'payment_method_id' => ['required', 'uuid'],
            'amount_minor' => ['required', 'integer', 'min:1'],
            'idempotency_key' => ['required', 'string', 'max:128'],
            'reference' => ['nullable', 'string', 'max:255'],
            'payment_details' => ['nullable', 'array'],
        ];
    }
}
