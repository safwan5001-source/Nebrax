<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreInvoiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'          => ['required', 'uuid'],
            // اختياري لا مطلوب: عند الإنشاء يعني الغياب «استخدم تفضيل المستأجر»
            // (`sales.default_payment_type`)، وعند التعديل «أبقِ القيمة كما هي».
            // كونه مطلوباً كان يجعل التفضيل حبراً على ورق.
            'payment_type'        => ['nullable', 'in:cash,credit'],
            'invoice_date'        => ['nullable', 'date'],
            'due_date'            => ['nullable', 'date'],
            'discount'            => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات — خصم على مستوى الفاتورة
            'shipping'            => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات — رسوم الشحن (قبل الضريبة)
            'adjustment'          => ['nullable', 'integer', 'min:-100000000000', 'max:100000000000'],          // هللات — تسوية/تقريب (+/−)
            'tax_inclusive'       => ['nullable', 'boolean'], // هل أسعار السطور متضمّنة الضريبة (تُستخرَج) أم لا (تُضاف)
            'cost_center_id'      => ['nullable', 'uuid'],
            'salesperson_id'      => ['nullable', 'uuid'],
            'notes'               => ['nullable', 'string'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['nullable', 'uuid'],
            'items.*.discount'    => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات — خصم على مستوى السطر
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit_price'  => ['required', 'integer', 'min:0', 'max:100000000000'], // هللات
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }
}
