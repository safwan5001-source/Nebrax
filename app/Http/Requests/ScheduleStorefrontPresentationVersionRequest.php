<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;

/**
 * CUST-H1-4 — غلاف جدولة/استبدال/إعادة جدولة نسخة: مراجعة النسخة الهدف +
 * وقت مستقبلي بإزاحة صريحة + رمز حالة الجدولة الحالي (`expected_schedule_token`)
 * معاً. لا سلطة مستأجر/متجر من جسم الطلب — `{id}`/`{version}` محدِّدا مسار
 * فقط، والمستأجر من `TenantContext` حصراً.
 *
 * `scheduled_for` يُرفض شكلياً هنا (422) إن لم يحمل إزاحة صريحة (`Z` أو
 * `±HH:MM`) — لا نثق بتوقيت المتصفح ضمنياً مطلقاً. فحص "المستقبل" الفعلي
 * منفصل ويجري خادمياً تحت قفل في الخدمة (docs/plans/store/
 * CUST-H1-ARCH-1-...md §18).
 */
class ScheduleStorefrontPresentationVersionRequest extends FormRequest
{
    public const ALLOWED_KEYS = ['revision', 'scheduled_for', 'expected_schedule_token'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'revision' => ['required', 'integer', 'min:0'],
            'scheduled_for' => [
                'required',
                'string',
                'regex:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/',
            ],
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
