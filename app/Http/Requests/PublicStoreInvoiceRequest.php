<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * عقد إنشاء **مسودّة** فاتورة مبيعات عبر الـ Public API — قائمة سماح صريحة أصغر
 * من الداخلي: لا حقول ترحيل/سداد/تحصيل/ZATCA/مراكز تكلفة/تجاوز سعر أدنى، ولا
 * إجماليات يفرضها العميل (الخادم يحسبها من السطور). النقود بالوحدات الصغرى.
 *
 * ما يُسقَط بنيويًا عبر `validated()`: is_paid/payment_method/cash_account_id،
 * zatca_document_type، status، subtotal/tax_amount/total، classification_id،
 * salesperson_id، cost_center_id، minimum_price_override_reason، tenant_id.
 *
 * الفرع اختياري (يُتحقَّق ملكيّته في المتحكّم)، وغيابه ⇒ الفرع الرئيسي للمستأجر.
 */
class PublicStoreInvoiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'   => ['required', 'uuid'],
            'branch_id'    => ['nullable', 'uuid'],
            'warehouse_id' => ['nullable', 'uuid'],
            'invoice_date' => ['nullable', 'date'],
            'due_date'     => ['nullable', 'date'],
            'payment_type' => ['nullable', 'in:cash,credit'],
            'notes'        => ['nullable', 'string', 'max:2000'],

            'items'                    => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id'       => ['nullable', 'uuid'],
            'items.*.description'      => ['nullable', 'string', 'max:1000'],
            'items.*.quantity'         => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit'             => ['nullable', 'string', 'max:255'],
            'items.*.unit_price_minor' => ['required', 'integer', 'min:0', 'max:100000000000'],
            'items.*.tax_rate'         => ['nullable', 'integer', 'min:0', 'max:100'],
            'items.*.discount_minor'   => ['nullable', 'integer', 'min:0', 'max:100000000000'],
        ];
    }
}
