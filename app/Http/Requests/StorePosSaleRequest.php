<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePosSaleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $rules = [
            'partner_id'          => ['required', 'uuid'],
            'pos_session_id'      => ['required', 'uuid'],
            // مفتاح محاولة منطقية ثابتة: إعادة الإرسال بنفس المفتاح لا تنشئ بيعاً ثانياً.
            'idempotency_key'     => ['required', 'uuid'],
            // اختياري للتوافق مع محطات POS/تكاملات قديمة؛ الواجهة الجديدة تنشئه خادمياً.
            'cart_id'             => ['nullable', 'uuid'],
            // يثبت مخزن الإخراج على الفاتورة الناتجة من عملية نقطة البيع.
            'warehouse_id'        => ['nullable', 'uuid'],
            'tax_inclusive'       => ['nullable', 'boolean'],
            // DLV-POS-1: هوية الملف فقط. وضع التحصيل والنسخة والحساب لا تُقبل من العميل.
            'delivery_platform_profile_id' => ['nullable', 'uuid'],
            'external_order_reference' => ['nullable', 'string', 'max:255'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['nullable', 'uuid'],
            // VAR-POS-1: هويّة المتغيّر الفعلي — إضافيّ، فارغ لمنتجٍ بسيط.
            // إلزاميّته لمنتجٍ متعدد الخيارات تُفرَض خادمياً في PosService/InvoiceService، لا هنا.
            'items.*.product_variant_id' => ['nullable', 'uuid'],
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit'        => ['nullable', 'string', 'max:100'],
            'items.*.unit_price'  => ['required', 'integer', 'min:0', 'max:100000000000'], // هللات
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
            'items.*.discount'    => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات
            'items.*.minimum_price_override_reason' => ['nullable', 'string', 'min:3', 'max:500'],
            'notes'               => ['nullable', 'string', 'max:2000'],
            // بلا منصة تبقى الوسائل مطلوبة كما كانت. مع منصة قد يشتق الخادم تحصيلاً بلا وسيلة.
            'tenders'             => ['required_without:delivery_platform_profile_id', 'array', 'max:20'],
        ];

        // العقد الجديد: قائمة وسائل مهيأة بالهللات. العقد القديم يبقى مقبولاً
        // للمحطات والتكاملات القائمة، ويُحوَّل خادمياً إلى الوسائل المهيأة.
        if (array_is_list($this->input('tenders', []))) {
            return [
                ...$rules,
                'tenders.*'                   => ['required', 'array:payment_method_id,amount'],
                'tenders.*.payment_method_id' => ['required', 'uuid', 'distinct'],
                'tenders.*.amount'            => ['required', 'integer', 'min:1', 'max:100000000000'], // هللات
            ];
        }

        return [
            ...$rules,
            'tenders.cash'     => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'tenders.card'     => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'tenders.transfer' => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'tenders.credit'   => ['nullable', 'integer', 'min:0', 'max:100000000000'],
        ];
    }

    public function withValidator(\Illuminate\Validation\Validator $validator): void
    {
        $validator->after(function (\Illuminate\Validation\Validator $validator): void {
            foreach ([
                'collection_mode',
                'delivery_platform_profile_version_id',
                'version_id',
                'clearing_account_id',
                'gl_account_id',
                'accounting_role',
                'commission',
                'commission_rate',
                'tax_treatment',
            ] as $field) {
                if ($this->exists($field)) {
                    $validator->errors()->add($field, 'هذا الحقل لا يُقبل من نقطة البيع؛ الخادم يحدد سلوك المنصة.');
                }
            }
        });
    }
}
