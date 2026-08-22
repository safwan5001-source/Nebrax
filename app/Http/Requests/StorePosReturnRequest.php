<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * عقد مرتجع نقطة البيع: مصدر الحقيقة هو فاتورة POS الخادمية. لا يقبل العقد
 * المنتج أو السعر أو الضريبة أو العميل، حتى لا تتحول واجهة الكاشير إلى سلطة
 * مالية قادرة على إعادة تفسير فاتورة مرحّلة.
 */
class StorePosReturnRequest extends FormRequest
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
            'restock'            => ['nullable', 'boolean'],
            'notes'              => ['nullable', 'string', 'max:2000'],
            'items'              => ['required', 'array', 'min:1'],
            'items.*.source_line_id' => ['required', 'uuid', 'distinct'],
            'items.*.quantity'       => ['required', 'integer', 'min:1', 'max:1000000'],
        ];
    }
}
