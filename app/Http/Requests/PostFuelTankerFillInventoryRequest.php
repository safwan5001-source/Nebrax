<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * TANKER-PR6B-3: ترحيل سند تعبئة مخزنياً. الكمية والتكلفة والحسابات والتاريخ **كلها من الخادم** (السند والإعدادات)؛ لا يقبل الطلب أياً منها.
 * `reason` اختياري (إلزامي للسند التاريخي) و`confirm_historical` تأكيد مراجعة السند التاريخي. أي مفتاح آخر مرفوض.
 */
class PostFuelTankerFillInventoryRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return ['reason' => ['nullable', 'string', 'max:500'], 'confirm_historical' => ['nullable', 'boolean']];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $unknown = array_values(array_diff(array_keys($this->all()), ['reason', 'confirm_historical']));
            if ($unknown !== []) {
                $validator->errors()->add('request', 'حقول غير مسموحة: ' . implode(', ', $unknown));
            }
        });
    }
}
