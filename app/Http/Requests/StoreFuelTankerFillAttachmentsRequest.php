<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/** TANKER-PR5: شكل طلب رفع مرفقات السند فقط (1–5 ملفات). المحتوى الفعلي والنوع والحجم والسياسة في `FuelTankerFillAttachmentService`. لا `tenant_id` ولا حقول مجهولة. */
class StoreFuelTankerFillAttachmentsRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'attachments' => ['required', 'array', 'min:1', 'max:5'],
            'attachments.*' => ['file'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $unknown = array_values(array_diff(array_keys($this->all()), ['attachments']));
            if ($unknown !== []) {
                $validator->errors()->add('request', 'حقول غير مسموحة: ' . implode(', ', $unknown));
            }
        });
    }
}
