<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;

/**
 * CUST-H1-3 — غلاف نشر نسخة عرض محدَّدة فوراً: مراجعة النسخة الهدف +
 * حالة رأس النشر التي راجعها التاجر (`expected_published_revision`/
 * `expected_active_version_id`) معاً. لا سلطة مستأجر/متجر من جسم الطلب —
 * `{id}`/`{version}` محدِّدا مسار فقط، والمستأجر من `TenantContext` حصراً.
 *
 * `expected_published_revision`/`expected_active_version_id` **مطلوبان
 * الحضور صراحةً حتى لو كانت قيمتهما null** — تمثّلان "لا نشر بعد"/"لا نسخة
 * نشِطة بعد"، وهي حالة رأس نشر صالحة تماماً يجب التحقق منها كأي حالة أخرى
 * (docs/plans/store/CUST-H1-ARCH-1-...md §11 خطوة 7).
 */
class PublishStorefrontPresentationVersionRequest extends FormRequest
{
    public const ALLOWED_KEYS = ['revision', 'expected_published_revision', 'expected_active_version_id'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'revision' => ['required', 'integer', 'min:0'],
            'expected_published_revision' => ['present', 'nullable', 'integer', 'min:0'],
            'expected_active_version_id' => ['present', 'nullable', 'string', 'uuid'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function () {
            $this->rejectUnknown(self::ALLOWED_KEYS);
        });
    }

    /** @param  list<string>  $allowed */
    private function rejectUnknown(array $allowed): void
    {
        $decoded = json_decode((string) $this->getContent(), true);
        if ($decoded !== null && ! is_array($decoded)) {
            throw ValidationException::withMessages([
                'request' => 'جسم الطلب يجب أن يكون كائناً JSON.',
            ]);
        }

        $keys = is_array($decoded) ? array_keys($decoded) : array_keys($this->all());
        $unknown = array_values(array_diff($keys, $allowed));
        if ($unknown !== []) {
            throw ValidationException::withMessages([
                'request' => 'حقول غير مسموحة: '.implode(', ', $unknown),
            ]);
        }
    }
}
