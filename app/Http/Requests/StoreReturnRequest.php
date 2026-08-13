<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreReturnRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type'                => ['required', 'in:sales,purchase'],
            'partner_id'          => ['required', 'uuid'],
            'payment_type'        => ['required', 'in:cash,credit'],
            'return_date'         => ['nullable', 'date'],
            // المستند المصدر (اختياري ما لم يُلزِم به الإعداد). النوع يُستنتَج
            // من `type` في الخدمة، فلا يُرسله العميل ولا يُصدَّق إن أرسله.
            'original_id'         => ['nullable', 'uuid'],
            // هل تعود البضاعة للمخزون؟ الغياب = اتبع سياسة المستأجر.
            'restock'             => ['nullable', 'boolean'],
            'items.*.source_line_id' => ['nullable', 'uuid'],
            'notes'               => ['nullable', 'string'],
            'items'               => ['required', 'array', 'min:1'],
            // **المنتج إلزامي.** المرتجع أثرُه مخزونيٌّ لا مالي فقط: `ReturnService`
            // يُعيد البضاعة المتابَعة للمخزون ويعكس تكلفتها (مدين 1140 / دائن 5110)،
            // ومرتجع الشراء يُخرجها. وبلا منتج لا يُعرف أيُّ صنفٍ رُدَّ، فيمرّ
            // المرتجع بأثرٍ مالي وحده: المخزون لا يتحرّك، و5110 يبقى مضخّماً،
            // وهامش الربح الإجمالي يخرج خاطئاً — وهو ما كانت الشاشة تفعله فعلاً.
            //
            // والبنود الخدمية لم تُغلَق: تُدخَل بمنتج **غير متابَع مخزونياً**،
            // فيبقى ترحيلها إلى 5150 كما هو.
            'items.*.product_id'  => ['required', 'uuid'],
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit_price'  => ['required', 'integer', 'min:0', 'max:100000000000'],
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }

    public function messages(): array
    {
        return [
            'items.*.product_id.required' =>
                'كل بند في المرتجع يحتاج منتجاً — به وحده تعود البضاعة إلى المخزون. للبنود الخدمية أنشئ منتجاً غير متابَع مخزونياً.',
        ];
    }
}
