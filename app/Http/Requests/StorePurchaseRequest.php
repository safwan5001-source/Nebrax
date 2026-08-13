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
            'cost_center_id'      => ['nullable', 'uuid'],
            // خصم وشحن وتسوية على مستوى الفاتورة (هللات). الخصم والشحن يدخلان
            // تكلفة البضاعة؛ والتسوية فرقُ تقريب على 5170 — انظر هجرة 000049.
            'discount'            => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'shipping'            => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'adjustment'          => ['nullable', 'integer', 'min:-100000000000', 'max:100000000000'],
            'items.*.discount'    => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'notes'               => ['nullable', 'string'],
            'items'               => ['required', 'array', 'min:1'],
            // **المنتج إلزامي.** فاتورة الشراء مستندُ تكلفةٍ حقيقية: بلا منتج لا
            // يُعرَف أهي بضاعةٌ تُرسمَل مخزوناً أم مصروفُ فترة، فتسقط كلّها في
            // «5150 مصروفات عامة» — وهو ما كان يحدث فعلاً ويُفسد قائمة الدخل.
            //
            // ومصروفات فاتورة المورّد (شحن، تخليص) لم تُغلَق: تُدخَل بمنتج
            // **خدمي غير متابَع مخزونياً**، فيبقى ترحيلها إلى 5150 كما هو —
            // لكنها تصير بنداً مُدارَاً يُبحث عنه ويُقاس، لا نصّاً حرّاً.
            'items.*.product_id'  => ['required', 'uuid'],
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

    public function messages(): array
    {
        return [
            'items.*.product_id.required' =>
                'كل بند في فاتورة الشراء يحتاج منتجاً. للشحن أو التخليص أنشئ منتجاً خدمياً غير متابَع مخزونياً.',
        ];
    }
}
