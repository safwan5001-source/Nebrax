<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StoreCreditNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'           => ['required', 'uuid'],
            // مع مستند مصدر يستنتج الخادم النوع منه؛ بدونه يجب أن يكون النوع
            // صريحاً كي لا تعود المسودة المستقلة إلى افتراض مبيعات خفي.
            'type'                 => ['nullable', 'in:sales,purchase', 'required_without_all:original_purchase_id,original_invoice_id'],
            'original_purchase_id' => ['nullable', 'uuid'],
            'refund_type'         => ['nullable', 'in:credit,cash'],
            'note_date'           => ['nullable', 'date'],
            'reason'              => ['nullable', 'string', 'max:500'],
            'original_invoice_id' => ['nullable', 'uuid'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['nullable', 'uuid'],
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit_price'  => ['required', 'integer', 'min:0', 'max:100000000000'], // هللات
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($this->filled('original_purchase_id') && $this->filled('original_invoice_id')) {
                $validator->errors()->add('original_purchase_id', 'لا يجوز ربط الإشعار بفاتورة ومشتريات معاً.');
            }
        });
    }
}
