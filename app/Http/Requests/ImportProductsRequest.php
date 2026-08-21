<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ImportProductsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'mimes:csv,txt', 'max:2048'],
            'mode' => ['required', 'in:create,update'],
        ];
    }

    public function messages(): array
    {
        return [
            'file.mimes' => 'ارفع قالب CSV محفوظاً بترميز UTF-8.',
            'file.max'   => 'حجم ملف الاستيراد يجب ألا يتجاوز 2 ميغابايت.',
            'mode.in'    => 'اختر وضع إنشاء المنتجات أو تحديثها عبر SKU.',
        ];
    }
}
