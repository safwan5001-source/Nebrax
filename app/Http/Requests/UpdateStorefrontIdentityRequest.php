<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * STORE-ADMIN-ADOPT-1B-1 — تحديث هوية متجر قائم (`name`/`default_locale`
 * فقط). لا تُقبل هوية (مستأجر/قناة/متجر/نطاق) من العميل — `{id}` في المسار
 * يحدّد أي صفّ يُراد تحديثه، لا مَن يتصرّف كمستأجر؛ الملكية تُعاد التحقق منها
 * في الخدمة عبر `TenantContext`، لا من جسم الطلب.
 *
 * كلا الحقلين اختياري ومستقل: تمرير أحدهما فقط لا يمسّ الآخر. اسمٌ فارغ أو
 * بياضٌ فقط يُرفض — لا يُسمح بإفراغ اسم متجر عام حيّ صمتاً. `default_locale`
 * محصور بقائمة صريحة (`ar`, `en`) لا نصاً حراً، مطابقةً لسياسة اللغة في
 * `AWJ_STORE_LANGUAGE_DECISION.md`.
 */
class UpdateStorefrontIdentityRequest extends FormRequest
{
    public const ALLOWED_LOCALES = ['ar', 'en'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'default_locale' => ['sometimes', 'nullable', 'string', 'in:'.implode(',', self::ALLOWED_LOCALES)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            // الوسائط العامة (`TrimStrings`/`ConvertEmptyStringsToNull`) تحوّل
            // «   » إلى `null` قبل وصولها هنا، فتصبح مطابقةً لـ`null` صريحة —
            // التي يجب أن تبقى «لا تغيير». نقرأ الجسم الخام مباشرةً (لا يمسّه
            // تحويل الوسائط لأنه لا يُعيد كتابة محتوى الطلب) للتفريق فعلياً
            // بين «أُرسل بياضاً فقط» (يُرفض) و«أُرسل null/لم يُرسل» (لا تغيير).
            $raw = $this->rawJsonInput();

            if (
                array_key_exists('name', $raw)
                && $raw['name'] !== null
                && is_string($raw['name'])
                && trim($raw['name']) === ''
            ) {
                $validator->errors()->add('name', 'اسم المتجر لا يمكن أن يكون فارغاً أو بياضاً فقط.');
            }
        });
    }

    /** @return array<string, mixed> */
    private function rawJsonInput(): array
    {
        $decoded = json_decode((string) $this->getContent(), true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * القيم المُطبَّعة فقط — الاسم مُشذَّب من مسافات الأطراف، ولا يُعاد
     * الحقل إطلاقاً حين لا يُرسله العميل أصلاً (تمييز «لم يُرسَل» عن «أُرسل
     * فارغاً» يبقى في يد الخدمة).
     *
     * @return array{name?: ?string, default_locale?: ?string}
     */
    public function normalizedAttributes(): array
    {
        $attributes = [];

        if ($this->has('name')) {
            $name = $this->input('name');
            $attributes['name'] = $name === null ? null : trim((string) $name);
        }

        if ($this->has('default_locale')) {
            $attributes['default_locale'] = $this->input('default_locale');
        }

        return $attributes;
    }
}
