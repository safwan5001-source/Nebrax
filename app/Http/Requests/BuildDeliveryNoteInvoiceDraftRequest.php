<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class BuildDeliveryNoteInvoiceDraftRequest extends FormRequest
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
            'expected_versions' => ['required', 'array', 'min:1', 'max:50'],
            'expected_versions.*' => ['required', 'integer', 'min:1'],
            'idempotency_key' => ['required', 'string', 'min:8', 'max:128', 'regex:/^[A-Za-z0-9._:-]+$/'],
            'reason' => ['required', 'string', 'min:3', 'max:500'],
            'invoice_date' => ['nullable', 'date'],
            'due_date' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'tax_inclusive' => ['nullable', 'boolean'],
            'price_list_id' => ['nullable', 'uuid'],
            'cost_center_id' => ['nullable', 'uuid'],
            'line_pricing' => ['required', 'array', 'min:1', 'max:500'],
            'line_pricing.*.delivery_note_line_id' => ['required', 'uuid', 'distinct'],
            'line_pricing.*.unit_price' => ['required', 'integer', 'min:1', 'max:100000000000'],
            'line_pricing.*.tax_rate' => ['nullable', 'integer', 'min:0', 'max:100'],
            'line_pricing.*.discount' => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'line_pricing.*.minimum_price_override_reason' => ['nullable', 'string', 'min:3', 'max:500'],

            'tenant_id' => ['prohibited'],
            'branch_id' => ['prohibited'],
            'actor_id' => ['prohibited'],
            'invoice_id' => ['prohibited'],
            'invoice_number' => ['prohibited'],
            'status' => ['prohibited'],
            'items' => ['prohibited'],
            'partner_id' => ['prohibited'],
            'customer_id' => ['prohibited'],
            'warehouse_id' => ['prohibited'],
            'payment_type' => ['prohibited'],
            'is_paid' => ['prohibited'],
            'payment_method' => ['prohibited'],
            'payment_reference' => ['prohibited'],
            'cash_account_id' => ['prohibited'],
            'subtotal' => ['prohibited'],
            'total' => ['prohibited'],
            'tax_amount' => ['prohibited'],
            'shipping' => ['prohibited'],
            'adjustment' => ['prohibited'],
            'journal_entry_id' => ['prohibited'],
            'stock_movement_id' => ['prohibited'],
            'provider' => ['prohibited'],
            'raw_payload' => ['prohibited'],
        ];
    }
}
