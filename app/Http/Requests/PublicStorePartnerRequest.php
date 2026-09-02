<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * عقد إنشاء طرف عبر الـ Public API — **قائمة سماح صريحة** لحقلٍ آمنٍ مستقرّ.
 *
 * `validated()` يعيد المفاتيح المُدرَجة هنا فقط، فأيّ حقلٍ آخر يرسله العميل
 * (tenant_id، رصيد افتتاحي، مراجع تصنيف/قائمة أسعار، حدّ ائتمان، حالة داخلية…)
 * يُسقَط بنيويًا ولا يبلغ النموذج — تعزيزًا لحرس `fillable`. لا نكشف حقول
 * الواجهة الداخلية ولا الحقول ذات الأثر المحاسبي عبر هذا المسار.
 */
class PublicStorePartnerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // التفويض عبر سلسلة الوسائط (مفتاح API + scope الكتابة).
    }

    public function rules(): array
    {
        return [
            'name'        => ['required', 'string', 'max:255'],
            'name_en'     => ['nullable', 'string', 'max:255'],
            'type'        => ['required', 'in:customer,supplier,both'],
            'entity_type' => ['nullable', 'in:individual,commercial'],
            'code'        => ['nullable', 'string', 'max:255'],
            'vat_number'  => ['nullable', 'string', 'size:15'],
            'cr_number'   => ['nullable', 'string', 'max:255'],
            'email'       => ['nullable', 'email', 'max:255'],
            'phone'       => ['nullable', 'string', 'max:255'],
            'mobile'      => ['nullable', 'string', 'max:255'],
            'address'     => ['nullable', 'string', 'max:255'],
            'city'        => ['nullable', 'string', 'max:255'],
            'building_no' => ['nullable', 'string', 'max:255'],
            'street'      => ['nullable', 'string', 'max:255'],
            'district'    => ['nullable', 'string', 'max:255'],
            'postal_code' => ['nullable', 'string', 'max:255'],
            'country'     => ['nullable', 'string', 'max:255'],
            'is_active'   => ['nullable', 'boolean'],
        ];
    }
}
