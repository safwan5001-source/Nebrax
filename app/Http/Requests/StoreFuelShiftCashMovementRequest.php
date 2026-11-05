<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelShiftCashMovementRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'type' => ['required', 'in:cash_in,cash_out,expense'],
            'amount_minor' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'max:2000'],
            'evidence' => ['nullable', 'array'],
            // D5: تسليم نقد الوردية للخزنة/المشرف — الربط بالمستلم والإثبات يُتحقق منه في الخدمة تحت قفل الوردية.
            'purpose' => ['nullable', 'in:treasury_handover'],
            'received_by_user_id' => ['nullable', 'uuid'],
            'evidence.proof_reference' => ['nullable', 'string', 'max:200'],
            'idempotency_key' => ['required', 'string', 'max:128'],
            'recorded_at' => ['nullable', 'date'],
        ];
    }
}
