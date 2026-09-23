<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * تحقق شكل الطلب فقط (`schema` كائن موجود) — التحقق البنيوي العميق (مطابقة
 * حرفية لعقد `AppSchema` في `mobile/lib/schema/app_schema.dart`) في
 * `App\Services\AppBuilder\AppSchemaParser` (يُستدعى من الخدمة، لا هنا) —
 * طبقتان متعمَّدتان: هذه تمنع طلباً بلا `schema` إطلاقاً قبل الوصول للخدمة.
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
