<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CancelDeliveryNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'expected_version' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:3', 'max:500'],
            'tenant_id' => ['prohibited'],
            'branch_id' => ['prohibited'],
            'status' => ['prohibited'],
            'number' => ['prohibited'],
            'cancelled_by' => ['prohibited'],
            'cancelled_at' => ['prohibited'],
            'invoice_id' => ['prohibited'],
            'journal_entry_id' => ['prohibited'],
            'payment_id' => ['prohibited'],
            'stock_movement_id' => ['prohibited'],
        ];
    }
}
