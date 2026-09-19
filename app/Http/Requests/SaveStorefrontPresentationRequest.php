<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;

/**
 * STORE-BACKEND-1 — غلاف حفظ المسودة: `config` + `draft_revision` فقط.
 * حقول السلطة (`tenant_id` / `published_config` / `is_verified` / …) مرفوضة.
 */
class SaveStorefrontPresentationRequest extends FormRequest
{
    public const ALLOWED_KEYS = ['config', 'draft_revision'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'config' => ['required', 'array'],
            'draft_revision' => ['required', 'integer', 'min:0'],
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
