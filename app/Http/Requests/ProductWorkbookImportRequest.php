<?php

namespace App\Http\Requests;

use App\Services\ProductImportService;
use App\Support\ProductImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات مصنّف PR-UOM2-4 (فحص · معاينة · تطبيق) — ثلاث أوراق: Products،
 * Barcodes، Unit Prices. خيارات ورقة Products مطابقة حرفياً لـ
 * `ImportProductsRequest`؛ الجديد الوحيد هو `price_list_id` الإلزامي —
 * القرار D-F: لا قائمة سعر تُخمَّن، فطلبٌ بلا هذا الحقل يُرفض هنا قبل قراءة
 * الملف أصلاً.
 */
class ProductWorkbookImportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'mimes:xlsx', 'max:5120'],
            'price_list_id' => ['required', 'uuid'],
            'mode' => ['sometimes', Rule::in([
                ProductImportService::MODE_CREATE,
                ProductImportService::MODE_UPDATE,
                ProductImportService::MODE_UPSERT,
            ])],
            'blank_policy' => ['sometimes', Rule::in([
                ProductImportService::BLANK_IGNORE,
                ProductImportService::BLANK_CLEAR,
            ])],
            'master_data_policy' => ['sometimes', Rule::in([
                ProductImportService::MASTER_DATA_ERROR,
                ProductImportService::MASTER_DATA_TEXT,
                ProductImportService::MASTER_DATA_CREATE,
            ])],
            'mapping' => ['sometimes', 'array', 'max:'.ProductImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(ProductImportFields::keys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف XLSX ثلاثي الأوراق قبل المتابعة.',
            'file.mimes' => 'مصنّف Products/Barcodes/Unit Prices يجب أن يكون بصيغة XLSX.',
            'file.max' => 'حجم الملف يجب ألا يتجاوز 5 ميغابايت.',
            'price_list_id.required' => 'حدّد قائمة سعرٍ واحدة قبل استيراد ورقة Unit Prices.',
            'price_list_id.uuid' => 'معرّف قائمة السعر غير صالح.',
            'mode.in' => 'اختر وضع الإنشاء أو التحديث أو الدمج لورقة Products.',
            'blank_policy.in' => 'سياسة القيم الفارغة غير صالحة.',
            'master_data_policy.in' => 'سياسة البيانات الأساسية غير صالحة.',
            'mapping.*.in' => 'أحد أعمدة ورقة Products مربوط بحقل غير معروف.',
        ];
    }

    /** خيارات ورقة Products كما تستهلكها `ProductImportService`. @return array<string, mixed> */
    public function productOptions(): array
    {
        $options = [
            'mode' => $this->string('mode', ProductImportService::MODE_CREATE)->toString(),
            'blank_policy' => $this->string('blank_policy', ProductImportService::BLANK_IGNORE)->toString(),
            'master_data_policy' => $this->string('master_data_policy', ProductImportService::MASTER_DATA_TEXT)->toString(),
        ];

        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        return $options;
    }
}
