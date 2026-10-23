<?php

namespace App\Http\Requests;

use App\Services\ProductTaxonomyImportService;
use App\Support\ProductTaxonomyImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات فحص/معاينة استيراد التصنيفات والعلامات (IMP-H4-S5). **لا طلب تطبيق متزامن** (القاعدة 10): التنفيذ عبر التشغيلة الدائمة المربوطة بمعاينتها فقط.
 * الصلاحية `products.manage` تُفرض على المسار.
 */
class ProductTaxonomyImportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:5120'],
            'kind' => ['required', Rule::in(ProductTaxonomyImportFields::KINDS)],
            'mode' => ['sometimes', Rule::in([ProductTaxonomyImportService::MODE_CREATE, ProductTaxonomyImportService::MODE_UPDATE, ProductTaxonomyImportService::MODE_UPSERT])],
            'blank_policy' => ['sometimes', Rule::in([ProductTaxonomyImportService::BLANK_IGNORE, ProductTaxonomyImportService::BLANK_CLEAR])],
            'parent_policy' => ['sometimes', Rule::in([ProductTaxonomyImportService::PARENT_ERROR, ProductTaxonomyImportService::PARENT_CREATE])],
            'mapping' => ['sometimes', 'array', 'max:'.ProductTaxonomyImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(ProductTaxonomyImportFields::allKeys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'kind.required' => 'حدّد نوع الاستيراد: تصنيفات أو علامات تجارية.',
            'kind.in' => 'نوع الاستيراد يجب أن يكون تصنيفات أو علامات تجارية.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد هذا الاستيراد.',
        ];
    }

    /** @return array<string, mixed> */
    public function importOptions(): array
    {
        $options = ['kind' => $this->string('kind')->toString()];
        foreach (['mode', 'blank_policy', 'parent_policy'] as $key) {
            if ($this->has($key)) {
                $options[$key] = $this->string($key)->toString();
            }
        }
        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        return $options;
    }
}
