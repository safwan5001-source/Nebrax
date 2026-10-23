<?php

namespace App\Http\Requests;

use App\Services\UnitTemplateImportService;
use App\Support\UnitTemplateImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات فحص/معاينة استيراد قوالب الوحدات (IMP-H4-S5) — إنشاء فقط، **بلا مسار ذكاء اصطناعي** (D-08) ولا تطبيق متزامن. الصلاحية `products.manage` على المسار.
 */
class UnitTemplateImportRequest extends FormRequest
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
            'existing_policy' => ['sometimes', Rule::in([UnitTemplateImportService::EXISTING_ERROR, UnitTemplateImportService::EXISTING_SKIP])],
            'mapping' => ['sometimes', 'array', 'max:'.UnitTemplateImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(UnitTemplateImportFields::keys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد هذا الاستيراد.',
        ];
    }

    /** @return array<string, mixed> */
    public function importOptions(): array
    {
        $options = [];
        if ($this->has('existing_policy')) {
            $options['existing_policy'] = $this->string('existing_policy')->toString();
        }
        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        return $options;
    }
}
