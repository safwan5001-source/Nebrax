<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelSupplierInvoiceRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'supplier_id' => ['required', 'uuid'],
            'procurement_order_id' => ['nullable', 'uuid'],
            'purchase_id' => ['nullable', 'uuid'],
            'invoice_number' => ['required', 'string', 'max:128'],
            'invoice_date' => ['required', 'date'],
            'currency' => ['nullable', 'string', 'size:3'],
            'evidence' => ['nullable', 'array'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.fuel_product_id' => ['required', 'uuid'],
            'lines.*.quantity_liters' => ['required', 'regex:/^(0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/'],
            'lines.*.value_minor' => ['required', 'integer', 'min:0'],
        ];
    }
}
