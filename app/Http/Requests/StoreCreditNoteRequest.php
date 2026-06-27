<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreCreditNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'          => ['required', 'uuid'],
            'refund_type'         => ['nullable', 'in:credit,cash'],
            'note_date'           => ['nullable', 'date'],
            'reason'              => ['nullable', 'string', 'max:500'],
            'original_invoice_id' => ['nullable', 'uuid'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['nullable', 'uuid'],
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1'],
            'items.*.unit_price'  => ['required', 'integer', 'min:0'], // هللات
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }
}
