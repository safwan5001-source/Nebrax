<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;

/**
 * CUST-H1-1 — غلاف إعادة تسمية نسخة عرض: `name` + `revision` فقط.
 * رمز مراجعة واحد للصفّ كله (اسم + مستند) لتفادي دلالتَي تزامن منفصلتين
 * (docs/plans/store/CUST-H1-ARCH-1-...md §10 "Rename").
 */
class RenameStorefrontPresentationVersionRequest extends FormRequest
{
    public const ALLOWED_KEYS = ['name', 'revision'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'revision' => ['required', 'integer', 'min:0'],
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
