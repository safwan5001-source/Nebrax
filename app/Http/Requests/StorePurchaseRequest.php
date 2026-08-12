<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePurchaseRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'          => ['required', 'uuid'],
            // اختياري لا مطلوب: الغياب يعني «استخدم تفضيل المستأجر»
            // (`purchases.default_payment_type`). كونه مطلوباً كان يجعل
            // التفضيل حبراً على ورق — لا طلبَ يصل بلا قيمة فيُقرأ.
            'payment_type'        => ['nullable', 'in:cash,credit'],
            'purchase_date'       => ['nullable', 'date'],
            'due_date'            => ['nullable', 'date'],
            'supplier_invoice_no' => ['nullable', 'string', 'max:255'],
            'notes'               => ['nullable', 'string'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['nullable', 'uuid'],
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1', 'max:1000000'],
            // اسم الوحدة كما في قالب المنتج. الغياب = وحدة الأساس بمعامل ١؛
            // والاسم المجهول يُرفض في `UnitConversion` لا هنا، فالتحقق يحتاج
            // المنتج نفسه لا شكل الحقل.
            'items.*.unit'        => ['nullable', 'string', 'max:255'],
            'items.*.unit_price'  => ['required', 'integer', 'min:0', 'max:100000000000'],
            'tax_inclusive'       => ['nullable', 'boolean'], // هل تكاليف السطور متضمّنة الضريبة (تُستخرَج) أم لا (تُضاف)
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }
}
