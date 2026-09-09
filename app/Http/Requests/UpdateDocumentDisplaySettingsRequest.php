<?php

namespace App\Http\Requests;

use App\Support\PrintTemplateContract;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * إعدادات عرض المستندات على مستوى المؤسسة — لغة العرض الافتراضية.
 *
 * مستقلة عن اختيار القالب (#633) وعن لغة الواجهة. تُستهلَك عند إنشاء مسودة
 * جديدة تحمل `language=null`. لا تمسّ الأرقام أو الضرائب أو حقول ZATCA.
 */
class UpdateDocumentDisplaySettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // `null` يعني «اترك للنظام (العربية)» صراحةً؛ القيمة الصريحة مقيَّدة
            // بمفردات V1 من عقد `PrintTemplateContract`. الغياب في الطلب لا
            // يعبِّئ null — الحفاظ على السلوك مع `Settings::put` (يترك المفتاح).
            'default_language' => ['nullable', Rule::in(PrintTemplateContract::DOCUMENT_LANGUAGES)],
        ];
    }
}
