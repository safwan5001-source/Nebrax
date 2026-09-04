<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * معاينة مرتجع POS بلا كتابة: نفس عقد `StorePosReturnRequest` الوصفي، بلا
 * `idempotency_key` — لا مستند يُنشأ هنا فلا معنى لحمايته من التكرار (نظير
 * `QuotePosExchangeRequest` مقابل `StorePosExchangeRequest`).
 */
class QuotePosReturnRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'pos_session_id'     => ['required', 'uuid'],
            'original_invoice_id' => ['required', 'uuid'],
            'payment_type'       => ['required', 'in:cash,credit'],
            'items'              => ['required', 'array', 'min:1'],
            'items.*.source_line_id' => ['required', 'uuid', 'distinct'],
            'items.*.quantity'       => ['required', 'integer', 'min:1', 'max:1000000'],
        ];
    }
}
