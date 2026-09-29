<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;

/**
 * CUST-H1-4 — غلاف إلغاء جدولة نسخة: رمز حالة الجدولة الحالي فقط.
 * `DELETE .../versions/{version}/schedule` بجسم JSON — نفس النمط المستعمل
 * فعلاً في هذا المستودع لمسارات DELETE ذات معطى هويّة (راجع
 * `DestroyProductUnitPriceRequest`/`CommerceWorkspaceDisconnectCustomDomainApiTest`).
 */
class CancelStorefrontPresentationVersionScheduleRequest extends FormRequest
{
    public const ALLOWED_KEYS = ['expected_schedule_token'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'expected_schedule_token' => ['required', 'string'],
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
