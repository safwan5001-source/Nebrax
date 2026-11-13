<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/** TANKER-PR5: استبدال مرفق بملف واحد جديد. */
class ReplaceFuelTankerFillAttachmentRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return ['attachment' => ['required', 'file']];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $unknown = array_values(array_diff(array_keys($this->all()), ['attachment']));
            if ($unknown !== []) {
                $validator->errors()->add('request', 'حقول غير مسموحة: ' . implode(', ', $unknown));
            }
        });
    }
}
