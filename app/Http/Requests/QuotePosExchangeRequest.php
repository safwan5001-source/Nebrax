<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class QuotePosExchangeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'pos_session_id' => ['required', 'uuid'],
            'original_invoice_id' => ['required', 'uuid'],
            'return_items' => ['required', 'array', 'min:1'],
            'return_items.*.source_line_id' => ['required', 'uuid', 'distinct'],
            'return_items.*.quantity' => ['required', 'integer', 'min:1', 'max:1000000'],
            // ترسل الواجهة فائضاً محسوباً للعرض فقط؛ الخادم لا يثق به عند الترحيل
            // ويعيد التحقق من السياسة والمبلغ النهائي ضمن create().
            'cash_surplus_amount' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
