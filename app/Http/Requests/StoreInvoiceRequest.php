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
            // لقطة مسار ZATCA على الفاتورة: Standard (Clearance) أو Simplified (Reporting).
            'zatca_document_type'  => ['nullable', 'in:standard,simplified'],
            // اختياري للتوافق مع المستندات القديمة؛ يثبت مخزن الإخراج عند إرساله.
            'warehouse_id'        => ['nullable', 'uuid'],
            // اختيار يدوي لسعر اقتراحي؛ يبقى سعر السطر المرسل هو اللقطة التي تحسب منها الفاتورة.
            'price_list_id'        => ['nullable', 'uuid'],
            // اختياري لا مطلوب: عند الإنشاء يعني الغياب «استخدم تفضيل المستأجر»
            // (`sales.default_payment_type`)، وعند التعديل «أبقِ القيمة كما هي».
            // كونه مطلوباً كان يجعل التفضيل حبراً على ورق.
            'payment_type'        => ['nullable', 'in:cash,credit'],
            // «مدفوع بالفعل» + تفاصيله. الثلاثة مشروطة بالخانة: بلا `is_paid`
            // لا يُقرأ منها شيء، فلا سبيل لتسجيل تحصيل بلا إعلانه.
            'is_paid'             => ['nullable', 'boolean'],
            'payment_method'      => ['nullable', 'in:cash,transfer,card'],
            'payment_reference'   => ['nullable', 'string', 'max:255'],
            'cash_account_id'     => ['nullable', 'uuid'], // الخزينة — يتحقق نوعها PaymentService
            'invoice_date'        => ['nullable', 'date'],
            'due_date'            => ['nullable', 'date'],
            'discount'            => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات — خصم على مستوى الفاتورة
            'shipping'            => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات — رسوم الشحن (قبل الضريبة)
            'adjustment'          => ['nullable', 'integer', 'min:-100000000000', 'max:100000000000'],          // هللات — تسوية/تقريب (+/−)
            'tax_inclusive'       => ['nullable', 'boolean'], // هل أسعار السطور متضمّنة الضريبة (تُستخرَج) أم لا (تُضاف)
            'cost_center_id'      => ['nullable', 'uuid'],
            'classification_id'   => ['nullable', 'uuid'],
            'salesperson_id'      => ['nullable', 'uuid'],
            'notes'               => ['nullable', 'string'],
            // تجاوز تصميم المسودة: الغياب يُبقي القيمة، وnull يصفّر الاختيار.
            'print_template_override_revision_id' => ['nullable', 'uuid'],
            'pdf_template_override_revision_id'   => ['nullable', 'uuid'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['nullable', 'uuid'],
            'items.*.discount'    => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات — خصم على مستوى السطر
            // لا يمر السبب وحده: الخدمة تطلبه فقط إن خالف السعر الصافي الحد
            // وسياسة المبيعات مفعّلة، ثم تتحقق من صلاحية الفاعل الفعلية.
            'items.*.minimum_price_override_reason' => ['nullable', 'string', 'min:3', 'max:500'],
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1', 'max:1000000'],
            // اسم الوحدة كما في قالب المنتج. الغياب = وحدة الأساس بمعامل ١؛
            // والاسم المجهول يُرفض في `UnitConversion` لا هنا، فالتحقق يحتاج
            // المنتج نفسه لا شكل الحقل.
            'items.*.unit'        => ['nullable', 'string', 'max:255'],
            'items.*.unit_price'  => ['required', 'integer', 'min:0', 'max:100000000000'], // هللات
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
            // تخصيصات صافي السطر: النسبة بنقاط أساس (10000 = 100%) والمبلغ بالهللات.
            // يتحقق جمع النسب/المبالغ وتطابق المركز في الخدمة بعد احتساب السطر فعلياً.
            'items.*.cost_center_allocations'                      => ['nullable', 'array', 'min:1', 'max:20'],
            'items.*.cost_center_allocations.*.cost_center_id'     => ['required', 'uuid'],
            'items.*.cost_center_allocations.*.mode'               => ['required', 'in:percent,amount'],
            'items.*.cost_center_allocations.*.value'              => ['required', 'integer', 'min:1', 'max:100000000000'],
        ];
    }
}
