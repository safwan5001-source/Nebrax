<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * COM-STORE-PROVISION-1 — تزويد أول متجر إلكتروني للمستأجر الحالي.
 *
 * لا تُقبل هوية (مستأجر/قناة/متجر/نطاق) من العميل إطلاقاً — انظر
 * `StorefrontProvisioningService`. الحقل الوحيد المقبول اختياري بحت: اسم
 * عرض المتجر، يُستعمل فقط عند إنشاء `Storefront` جديد فعلياً (لا يُعدِّل
 * اسم متجرٍ قائمٍ عند التقارب).
 */
class ProvisionStorefrontRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }
}
