<?php

namespace App\Http\Requests;

use App\Support\Commerce\BusinessVertical;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

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
            // FLOWERS-H1: ملف النشاط عند إنشاء متجر جديد فقط (لا يغيّر متجراً قائماً).
            'business_vertical' => ['sometimes', 'nullable', 'string', Rule::in(BusinessVertical::values())],
            // B2C-DEFAULT: غيابه/null = تُفعَّل حسابات العملاء لقناة المتجر الجديدة؛ false الصريح يُحترم. لا أثر على قناة قائمة.
            'customer_accounts_enabled' => ['sometimes', 'nullable', 'boolean'],
        ];
    }

    /** `null` = لم يُرسَل ⇒ الافتراضي (مفعَّلة)؛ قيمة منطقية صريحة تُحترم كما أُرسلت. */
    public function customerAccountsEnabled(): ?bool
    {
        $value = $this->validated('customer_accounts_enabled');

        return $value === null ? null : (bool) $value;
    }
}
