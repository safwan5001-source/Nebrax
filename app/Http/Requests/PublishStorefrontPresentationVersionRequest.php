<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;

/**
 * CUST-H1-3 — نشر فوري لنسخة مظهر محددة.
 *
 * يحمل الطلب مراجعة النسخة وحالة رأس النشر التي راجعها العميل. لا يقبل أي
 * حقول سلطة أو إعدادات عرض؛ المستند يُقرأ من Version المملوكة للمستأجر.
 */
class PublishStorefrontPresentationVersionRequest extends FormRequest
{
    public const ALLOWED_KEYS = [
        'revision',
        'expected_published_revision',
        'expected_active_version_id',
    ];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'revision' => ['required', 'integer', 'min:0'],
            'expected_published_revision' => ['present', 'nullable', 'integer', 'min:0'],
            'expected_active_version_id' => ['present', 'nullable', 'uuid'],
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
