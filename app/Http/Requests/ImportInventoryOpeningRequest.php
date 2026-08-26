<?php

namespace App\Http\Requests;

use App\Services\InventoryOpeningImportService;
use App\Support\InventoryOpeningFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات استيراد الأرصدة الافتتاحية (فحص · معاينة · إنشاء مسودة).
 *
 * `opening_date` مطلوب على مستوى **المستند** لا الصف: الرصيد الافتتاحي نقطة
 * زمنية واحدة، وتاريخٌ لكل صف كان يجعل القيد الواحد بلا تاريخ صحيح.
 */
class ImportInventoryOpeningRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // `mimes` يعتمد على الامتداد وعلى نوع MIME المكتشَف؛ ملفات Excel
            // تصل أحياناً بـ`application/zip` فيُذكر الامتدادان معاً.
            'file'            => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:5120'],
            // `sometimes` هنا لأن **الفحص** لا يحتاج تاريخاً؛ والمعاينة والتطبيق
            // يفرضانه في الخدمة برسالة عربية واضحة، فلا يتكرّر الشرط في مكانين.
            'opening_date'    => ['sometimes', 'date_format:Y-m-d'],
            'allow_zero_cost' => ['sometimes', 'boolean'],
            'notes'           => ['sometimes', 'nullable', 'string', 'max:500'],
            'mapping'         => ['sometimes', 'array', 'max:' . InventoryOpeningImportService::MAX_COLUMNS],
            'mapping.*'       => ['nullable', 'string', Rule::in(array_merge(InventoryOpeningFields::keys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required'         => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes'            => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max'              => 'حجم الملف يجب ألا يتجاوز 5 ميغابايت.',
            'opening_date.date_format' => 'تاريخ الرصيد الافتتاحي يجب أن يكون بصيغة YYYY-MM-DD.',
            'mapping.*.in'          => 'أحد الأعمدة مربوط بحقل غير معروف في عقد الأرصدة الافتتاحية.',
        ];
    }

    /** @return array<string, mixed> */
    public function importOptions(): array
    {
        $options = [
            'opening_date'    => (string) $this->input('opening_date', ''),
            'allow_zero_cost' => $this->boolean('allow_zero_cost'),
            'notes'           => $this->input('notes'),
        ];

        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        return $options;
    }
}
