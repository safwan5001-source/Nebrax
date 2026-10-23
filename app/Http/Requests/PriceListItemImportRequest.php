<?php

namespace App\Http\Requests;

use App\Services\PriceListItemImportService;
use App\Support\PriceListItemImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات فحص/معاينة استيراد أسعار قائمة سعر (IMP-H4-S5). القائمة خيارٌ إلزامي مجمَّد للتشغيلة (لا عمود قائمة في الملف). **لا تطبيق متزامن.**
 * الصلاحية `company.manage` (= بوابة `POST price-lists/{id}/items`) تُفرض على المسار.
 */
class PriceListItemImportRequest extends FormRequest
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
            'price_list_id' => ['required', 'uuid'],
            'mode' => ['sometimes', Rule::in([PriceListItemImportService::MODE_CREATE, PriceListItemImportService::MODE_UPDATE, PriceListItemImportService::MODE_UPSERT])],
            'mapping' => ['sometimes', 'array', 'max:'.PriceListItemImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(PriceListItemImportFields::keys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'price_list_id.required' => 'اختر قائمة السعر المستهدفة.',
            'price_list_id.uuid' => 'معرّف قائمة السعر غير صالح.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد هذا الاستيراد.',
        ];
    }

    /** @return array<string, mixed> */
    public function importOptions(): array
    {
        $options = ['price_list_id' => $this->string('price_list_id')->toString()];
        if ($this->has('mode')) {
            $options['mode'] = $this->string('mode')->toString();
        }
        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        return $options;
    }
}
