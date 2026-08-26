<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateDeliveryNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'expected_version' => ['required', 'integer', 'min:1'],
            'customer_id' => ['required', 'uuid'],
            'warehouse_id' => ['required', 'uuid'],
            'delivery_date' => ['nullable', 'date'],
            'external_reference' => ['nullable', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'reason' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'uuid'],
            'items.*.unit' => ['nullable', 'string', 'max:255'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.quantity_numerator' => ['nullable', 'required_with:items.*.quantity_denominator', 'integer', 'min:1', 'max:1000000'],
            'items.*.quantity_denominator' => ['nullable', 'required_with:items.*.quantity_numerator', 'integer', 'min:1', 'max:1000000'],
            'items.*.description' => ['nullable', 'string', 'max:1000'],

            'tenant_id' => ['prohibited'],
            'branch_id' => ['prohibited'],
            'status' => ['prohibited'],
            'number' => ['prohibited'],
            'version' => ['prohibited'],
            'created_by' => ['prohibited'],
            'confirmed_by' => ['prohibited'],
            'confirmed_at' => ['prohibited'],
            'cancelled_by' => ['prohibited'],
            'cancelled_at' => ['prohibited'],
            'cancellation_reason' => ['prohibited'],
            'invoice_id' => ['prohibited'],
            'journal_entry_id' => ['prohibited'],
            'payment_id' => ['prohibited'],
            'stock_movement_id' => ['prohibited'],
            'provider' => ['prohibited'],
            'extraction' => ['prohibited'],
            'raw_payload' => ['prohibited'],
        ];
    }
}
