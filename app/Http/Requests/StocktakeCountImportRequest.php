<?php

namespace App\Http\Requests;

use App\Services\StocktakeCountImportService;
use App\Support\StocktakeCountImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات فحص/معاينة استيراد أعداد جردٍ مفتوح (IMP-H7-S1b). الجرد المستهدف خيارٌ إلزامي مجمَّد للتشغيلة (لا عمود جرد في الملف). **لا تطبيق متزامن.**
 * الصلاحية `products.manage` + قدرة `inventory.core` (= بوابة `POST stocktakes/{id}/count`) تُفرض على المسار.
 */
class StocktakeCountImportRequest extends FormRequest
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
            'stocktake_id' => ['required', 'uuid'],
            'existing_count_policy' => ['sometimes', Rule::in([StocktakeCountImportService::POLICY_ERROR, StocktakeCountImportService::POLICY_OVERWRITE, StocktakeCountImportService::POLICY_SKIP])],
            'mapping' => ['sometimes', 'array', 'max:'.StocktakeCountImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(StocktakeCountImportFields::keys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'stocktake_id.required' => 'اختر الجرد المستهدف.',
            'stocktake_id.uuid' => 'معرّف الجرد غير صالح.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد هذا الاستيراد.',
        ];
    }

    /** @return array<string, mixed> */
    public function importOptions(): array
    {
        $options = ['stocktake_id' => $this->string('stocktake_id')->toString()];
        if ($this->has('existing_count_policy')) {
            $options['existing_count_policy'] = $this->string('existing_count_policy')->toString();
        }
        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        return $options;
    }
}
