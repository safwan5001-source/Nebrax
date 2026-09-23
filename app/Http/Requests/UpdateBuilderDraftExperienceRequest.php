<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * تحقق شكل الطلب فقط (`schema` كائن موجود) — التحقق البنيوي العميق (مفاتيح
 * `APP_SCHEMA_V1.md` §4 المعروفة، الأنواع، `defaultLocale` ضمن `locales`)
 * في `AppSchemaStructuralValidator` (يُستدعى من الخدمة، لا هنا) — طبقتان
 * متعمَّدتان: هذه تمنع طلباً بلا `schema` إطلاقاً قبل الوصول للخدمة.
 */
class UpdateBuilderDraftExperienceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'schema' => ['required', 'array'],
        ];
    }
}
