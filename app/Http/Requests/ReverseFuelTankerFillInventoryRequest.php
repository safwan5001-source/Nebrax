<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * TANKER-PR6B-4: عكس ترحيل سند تعبئة. الكمية والتكلفة والحسابات والتاريخ **كلها من الخادم** (صف الترحيل الثابت والقيد الأصلي)؛ لا يقبل الطلب أياً منها.
 * `reason` إلزامي (سبب العكس)، وأي مفتاح آخر مرفوض.
 */
class ReverseFuelTankerFillInventoryRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return ['reason' => ['required', 'string', 'min:3', 'max:500']];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $unknown = array_values(array_diff(array_keys($this->all()), ['reason']));
            if ($unknown !== []) {
                $validator->errors()->add('request', 'حقول غير مسموحة: ' . implode(', ', $unknown));
            }
        });
    }
}
