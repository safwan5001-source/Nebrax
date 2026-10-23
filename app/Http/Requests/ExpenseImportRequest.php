<?php

namespace App\Http\Requests;

use App\Services\ExpenseImportService;
use App\Support\ExpenseImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات فحص/معاينة استيراد المصروفات (IMP-H5-S2): مسودات فقط، **بلا تطبيق متزامن**. السياسات تُجمَّد مع المعاينة. الصلاحية `expenses.manage` + قدرة
 * `finance.operations` (= بوابة `POST /expenses`) تُفرض على المسار.
 */
class ExpenseImportRequest extends FormRequest
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
            'reference_policy' => ['sometimes', Rule::in([ExpenseImportService::REFERENCE_OPTIONAL, ExpenseImportService::REFERENCE_REQUIRED])],
            'default_account_id' => ['sometimes', 'nullable', 'uuid'],
            'default_payment_method' => ['sometimes', Rule::in(ExpenseImportFields::PAYMENT_METHODS)],
            'default_tax_rate' => ['sometimes', 'integer', 'min:0', 'max:100'],
            'confirmed_repeat_rows' => ['sometimes', 'array', 'max:'.ExpenseImportService::MAX_ROWS],
            'confirmed_repeat_rows.*' => ['integer', 'min:2'],
            'mapping' => ['sometimes', 'array', 'max:'.ExpenseImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(ExpenseImportFields::keys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'default_account_id.uuid' => 'معرّف حساب المصروف الافتراضي غير صالح.',
            'default_tax_rate.integer' => 'نسبة الضريبة الافتراضية يجب أن تكون عدداً صحيحاً بين 0 و100.',
            'confirmed_repeat_rows.*.integer' => 'أرقام صفوف التكرار المؤكَّد يجب أن تكون أرقام صفوف من الورقة.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد هذا الاستيراد.',
        ];
    }

    /** @return array<string, mixed> */
    public function importOptions(): array
    {
        $options = [];
        foreach (['reference_policy', 'default_account_id', 'default_payment_method'] as $key) {
            if ($this->has($key)) {
                $options[$key] = $this->string($key)->toString();
            }
        }
        if ($this->has('default_tax_rate')) {
            $options['default_tax_rate'] = $this->input('default_tax_rate');
        }
        if ($this->has('confirmed_repeat_rows')) {
            $options['confirmed_repeat_rows'] = (array) $this->input('confirmed_repeat_rows', []);
        }
        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        return $options;
    }
}
