<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreQuoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'          => ['required', 'uuid'],
            'quote_date'          => ['nullable', 'date'],
            'valid_until'         => ['nullable', 'date'],
            'status'              => ['nullable', 'in:draft,sent,accepted,rejected'],
            'notes'               => ['nullable', 'string'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['nullable', 'uuid'],
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1'],
            'items.*.unit_price'  => ['required', 'integer', 'min:0'], // هللات
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }
}
