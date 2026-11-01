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
            'commerce_payment_hold_minutes' => ['nullable', 'integer', 'min:'.\App\Support\CommercePaymentHold::MIN_MINUTES, 'max:'.\App\Support\CommercePaymentHold::MAX_MINUTES],
            // AD-09 / S08a: نافذة أيام ترتيب الشعبية في قوائم منتجات التجارة (سياسة عمل قابلة للضبط).
            'popularity_window_days' => ['nullable', 'integer', 'min:'.\App\Support\Commerce\ProductPopularity::MIN_DAYS, 'max:'.\App\Support\Commerce\ProductPopularity::MAX_DAYS],
            // H4-03 / D-13: لا يُقبل `on_payment_confirmed` ما دامت بوابة النشر ومرجع EXT-05 مغلقين (لا تفعيل بقرار مستأجر منفرد).
            'commerce_invoice_trigger' => ['nullable', Rule::in(\App\Support\CommerceInvoiceOnPayment::gateOpen() ? \App\Support\CommerceInvoiceOnPayment::TRIGGERS : [\App\Support\CommerceInvoiceOnPayment::TRIGGER_NONE])],
            'commerce_price_tax_mode' => ['nullable', Rule::in(\App\Support\CommerceInvoiceOnPayment::PRICE_MODES)],
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
