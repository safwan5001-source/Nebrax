<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;

/**
 * STORE-BACKEND-1 — غلاف النشر: `draft_revision` اختياري فقط.
 */
class PublishStorefrontPresentationRequest extends FormRequest
{
    public const ALLOWED_KEYS = ['draft_revision'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'draft_revision' => ['sometimes', 'integer', 'min:0'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function () {
            $this->rejectUnknown(self::ALLOWED_KEYS);
        });
    }

    public function expectedRevision(): ?int
    {
        if (! $this->exists('draft_revision')) {
            return null;
        }

        return (int) $this->input('draft_revision');
    }

    /** @param  list<string>  $allowed */
    private function rejectUnknown(array $allowed): void
    {
        $raw = (string) $this->getContent();
        if (trim($raw) === '') {
            return;
        }

        $decoded = json_decode($raw, true);
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
