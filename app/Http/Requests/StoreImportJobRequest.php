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
            // عبر كل أسطح الاستيراد. `mimes` سقفٌ عامٌّ يشمل امتدادات كل
            // المجالات معاً؛ التضييق لكل مجال (XLSX حصراً لـ`product_workbook`،
            // مطابقاً `ProductWorkbookImportRequest` حرفياً) في الإغلاق أدناه.
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:5120', function ($attribute, $value, $fail) {
                $domain = (string) $this->input('domain');
                $extension = strtolower((string) $value->getClientOriginalExtension());
                if ($domain === ImportJobDomain::PRODUCT_WORKBOOK && $extension !== 'xlsx') {
                    $fail('مصنّف Products/Barcodes/Unit Prices يجب أن يكون بصيغة XLSX.');
                }
            }],
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
