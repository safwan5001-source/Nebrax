<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateInventorySettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'allow_negative_stock'  => ['nullable', 'boolean'],
            'show_stock_quantities' => ['nullable', 'boolean'],
            'restock_sales_returns' => ['nullable', 'boolean'],
            'low_stock_notifications_enabled'    => ['nullable', 'boolean'],
            'out_of_stock_notifications_enabled' => ['nullable', 'boolean'],
            // التتبع التفصيلي غير مبنيّ بعد: لا جدول دفعات ولا أرقام مسلسلة ولا
            // طبقة تكلفة لكل دفعة. فيُقبل إطفاؤه صراحةً ويُرفض تفعيله برسالة
            // مفهومة — أوضح من تجاهلٍ صامت يظنّه المستخدم حفظاً.
            //
            // `sometimes` لا `nullable`: قاعدة `declined` **ضمنية** (implicit)
            // فتعمل على الحقل الغائب أيضاً، ولولا `sometimes` لأسقطت كل طلب
            // لا يرسله — أي كل طلبات هذه الشاشة.
            'detailed_tracking_enabled' => ['sometimes', 'declined'],
        ];
    }

    public function messages(): array
    {
        return [
            'detailed_tracking_enabled.declined' =>
                'التتبع بالرقم المسلسل أو رقم الشحنة أو تاريخ الانتهاء غير مبنيّ بعد، فلا يمكن تفعيله.',
        ];
    }
}
