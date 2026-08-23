<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelSupplierInvoiceMatchRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'fuel_supplier_invoice_line_id' => ['required', 'uuid'],
            'fuel_delivery_id' => ['required', 'uuid'],
            'quantity_liters' => ['required', 'regex:/^(0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/'],
            'idempotency_key' => ['required', 'string', 'max:128'],
        ];
    }
}
