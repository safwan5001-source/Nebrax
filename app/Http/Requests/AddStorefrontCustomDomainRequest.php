<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * STORE-ADMIN-ADOPT-1B-3A — إضافة نطاق مخصَّص لمتجر قائم.
 *
 * الحقل الوحيد المقبول: `hostname` نصّاً خاماً. كل حقل سلطة آخر
 * (`tenant_id`/`storefront_id`/`type`/`verification_status`/
 * `verification_token`/`verified_at`/`is_primary`/`is_active`) **غير معلن في
 * `rules()` أصلاً** — لا `sometimes`/`nullable` يفتح له باباً، فلا يصل أياً
 * منها إلى `validated()` مهما أرسله العميل؛ الخدمة (`CommerceWorkspaceStorefrontsService::addCustomDomainForCurrentTenant()`)
 * تحدّدها خادمياً حصراً. التحقّق التركيبي الحقيقي لـ`hostname` نفسه (تسمية/
 * طول/مخطط/منفذ) يجري لاحقاً عبر `HostnameNormalizer::normalize()` في
 * الخدمة — لا تكرار منطق هنا، فقط حدّ طول خام معقول يمنع حمولة ضخمة قبل
 * وصولها للمطبّع.
 */
class AddStorefrontCustomDomainRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'hostname' => ['required', 'string', 'max:512'],
        ];
    }
}
