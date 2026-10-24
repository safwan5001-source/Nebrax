<?php

namespace App\Http\Requests;

use App\Services\PurchaseImportService;
use App\Support\PurchaseImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات فحص/معاينة استيراد فواتير المشتريات (IMP-H5-S4a): مسودات فقط، **بلا تطبيق متزامن**. السياسات تُجمَّد مع المعاينة. الصلاحية `purchases.manage` + قدرة
 * `purchases.cycle` (= بوابة `POST /purchases`) تُفرض على المسار، وصلاحية المستودع على الفاعل في المتحكّم.
 */
class PurchaseImportRequest extends FormRequest
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
            'default_supplier_id' => ['sometimes', 'nullable', 'uuid'],
            'default_payment_type' => ['sometimes', 'nullable', Rule::in(PurchaseImportFields::PAYMENT_TYPES)],
            'default_tax_rate' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100'],
            'tax_inclusive' => ['sometimes', 'nullable', 'boolean'],
            'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'mapping' => ['sometimes', 'array', 'max:'.PurchaseImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(PurchaseImportFields::keys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'default_supplier_id.uuid' => 'معرّف المورّد الافتراضي غير صالح.',
            'default_payment_type.in' => 'نوع الدفع الافتراضي يقبل نقد أو آجل.',
            'default_tax_rate.integer' => 'نسبة الضريبة الافتراضية يجب أن تكون عدداً صحيحاً بين 0 و100.',
            'warehouse_id.uuid' => 'معرّف المستودع غير صالح.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد هذا الاستيراد.',
        ];
    }

    /** @return array<string, mixed> */
    public function importOptions(): array
    {
        $options = [];
        foreach (['default_supplier_id', 'default_payment_type', 'warehouse_id'] as $key) {
            if ($this->has($key)) {
                $options[$key] = $this->string($key)->toString();
            }
        }
        if ($this->has('default_tax_rate')) {
            $options['default_tax_rate'] = $this->input('default_tax_rate');
        }
        if ($this->has('tax_inclusive')) {
            $options['tax_inclusive'] = $this->input('tax_inclusive') === null ? null : $this->boolean('tax_inclusive');
        }
        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        return $options;
    }
}
