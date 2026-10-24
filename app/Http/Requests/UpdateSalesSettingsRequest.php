<?php

namespace App\Http\Requests;

use App\Support\CashSaleTreasuryPolicy;
use App\Support\CommercePartnerPolicy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateSalesSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'default_tax_rate'     => ['nullable', 'integer', 'min:0', 'max:100'],
            'default_payment_type' => ['nullable', 'in:cash,credit'],
            'quote_validity_days'  => ['nullable', 'integer', 'min:0', 'max:365'],
            'default_terms'        => ['nullable', 'string', 'max:2000'],
            'require_return_source' => ['nullable', 'boolean'],
            'return_window_days'      => ['nullable', 'integer', 'min:0', 'max:3650'],
            'enforce_min_sale_price' => ['nullable', 'boolean'],
            'allow_standalone_credit_notes' => ['nullable', 'boolean'],
            // TREASURY-T4: القيم غير `legacy` مرفوضة (422) ما دامت بوابة التفعيل المنسَّق مغلقة — لا يُفعَّل التوجيه بقرار مستأجر منفرد.
            'cash_sale_treasury_policy' => [
                'nullable',
                Rule::in(CashSaleTreasuryPolicy::activationOpen() ? CashSaleTreasuryPolicy::VALUES : [CashSaleTreasuryPolicy::LEGACY]),
            ],
            // H4-01 / D-05: سياسة ربط مشتري المتجر بطرف (تُقرأ عند إنشاء نية دفع إلكتروني فقط).
            'commerce_partner_policy' => ['nullable', Rule::in(CommercePartnerPolicy::VALUES)],
        ];
    }

    public function messages(): array
    {
        return [
            'cash_sale_treasury_policy.in' => CashSaleTreasuryPolicy::activationOpen()
                ? 'سياسة خزينة البيع النقدي غير صالحة.'
                : 'توجيه خزينة البيع النقدي غير مفعَّل بعد لهذا النظام؛ القيمة الوحيدة المتاحة «legacy».',
        ];
    }
}
