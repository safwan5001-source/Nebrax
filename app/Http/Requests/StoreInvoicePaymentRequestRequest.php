<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** إنشاء طلب دفع لفاتورة (PAY-H2-02b). الجزئي ممنوع افتراضياً (D-16)؛ الصلاحية على المسار. */
class StoreInvoicePaymentRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'payment_gateway_id' => ['required', 'uuid'],
            'allow_partial' => ['nullable', 'boolean'],
            'expires_in_minutes' => ['nullable', 'integer', 'min:5', 'max:43200'],
        ];
    }
}
