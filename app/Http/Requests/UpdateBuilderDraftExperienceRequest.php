<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * AD-01 (S01a): `base_revision` اختياري انتقالياً (عدد صحيح ≥ 0، `null` = غائب) —
 * القفل التفاؤلي في `BuilderDraftExperienceService`؛ لا يُفرض 428 قبل حصر مسارات الحفظ.
 *
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
            // `integer` في Laravel يقبل `true` (يتحوّل إلى 1): نرفض المنطقي صراحةً كي لا يصير أساساً صالحاً.
            'base_revision' => [
                'nullable',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (is_bool($value)) {
                        $fail('base_revision يجب أن يكون عدداً صحيحاً.');
                    }
                },
                'integer',
                'min:0',
            ],
        ];
    }
}
