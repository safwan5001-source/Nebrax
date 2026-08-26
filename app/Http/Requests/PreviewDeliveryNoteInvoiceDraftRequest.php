<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class PreviewDeliveryNoteInvoiceDraftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'delivery_note_ids' => ['required', 'array', 'min:1', 'max:50'],
            'delivery_note_ids.*' => ['required', 'uuid', 'distinct'],
            'price_list_id' => ['nullable', 'uuid'],
            'tenant_id' => ['prohibited'],
            'branch_id' => ['prohibited'],
            'invoice_id' => ['prohibited'],
            'invoice_number' => ['prohibited'],
            'status' => ['prohibited'],
            'payment_type' => ['prohibited'],
            'is_paid' => ['prohibited'],
            'payment_method' => ['prohibited'],
            'payment_reference' => ['prohibited'],
            'cash_account_id' => ['prohibited'],
            'subtotal' => ['prohibited'],
            'total' => ['prohibited'],
            'tax_amount' => ['prohibited'],
            'journal_entry_id' => ['prohibited'],
            'stock_movement_id' => ['prohibited'],
            'provider' => ['prohibited'],
            'raw_payload' => ['prohibited'],
        ];
    }
}
