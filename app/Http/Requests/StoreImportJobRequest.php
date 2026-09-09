<?php

namespace App\Http\Requests;

use App\Support\ImportJobDomain;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreImportJobRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // نفس قواعد `ImportProductsRequest` حرفياً — سقف حجم وامتداد موحّد
            // عبر كل أسطح الاستيراد.
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:5120'],
            'domain' => ['required', Rule::in(ImportJobDomain::values())],
            'idempotency_key' => ['sometimes', 'nullable', 'string', 'max:191'],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'domain.required' => 'حدّد مجال الاستيراد.',
            'domain.in' => 'مجال الاستيراد غير مدعوم.',
        ];
    }
}
