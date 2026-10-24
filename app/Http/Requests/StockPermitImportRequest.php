<?php

namespace App\Http\Requests;

use App\Models\StockPermit;
use App\Services\StockPermitImportAdapter;
use App\Services\StockPermitImportService;
use App\Support\StockPermitImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات فحص/معاينة استيراد بنود إذنٍ مخزني (IMP-H7-S3). رأس الإذن خيارات إلزامية مجمَّدة للتشغيلة (لا أعمدة في الملف). **لا تطبيق متزامن.**
 * الصلاحية `products.manage` + `inventory.core` (= بوابتا `POST stock-permits`) تُفرض على المسار.
 */
class StockPermitImportRequest extends FormRequest
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
            'permit_type' => ['required', Rule::in(StockPermit::TYPES)],
            'warehouse_id' => ['required', 'uuid'],
            'target_warehouse_id' => ['nullable', 'uuid'],
            'permit_date' => ['nullable', 'date_format:Y-m-d'],
            'reason' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string', 'max:500'],
            'allow_zero_cost' => ['sometimes', 'boolean'],
            'mapping' => ['sometimes', 'array', 'max:'.StockPermitImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(StockPermitImportFields::keys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'permit_type.required' => 'اختر نوع الإذن: إضافة أو صرف أو تحويل.',
            'warehouse_id.required' => 'اختر المخزن.',
            'warehouse_id.uuid' => 'معرّف المخزن غير صالح.',
            'target_warehouse_id.uuid' => 'معرّف مخزن الوجهة غير صالح.',
            'permit_date.date_format' => 'تاريخ الإذن بصيغة YYYY-MM-DD.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد هذا الاستيراد.',
        ];
    }

    /** الخيارات القانونية المجمَّدة (التاريخ الافتراضي يُحسم هنا فيتجمّد مع بصمة المعاينة). @return array<string, mixed> */
    public function importOptions(): array
    {
        $raw = [
            'permit_type' => $this->string('permit_type')->toString(),
            'warehouse_id' => $this->string('warehouse_id')->toString(),
            'target_warehouse_id' => $this->input('target_warehouse_id'),
            'permit_date' => $this->input('permit_date'),
            'reason' => $this->input('reason'),
            'notes' => $this->input('notes'),
            'allow_zero_cost' => $this->boolean('allow_zero_cost'),
        ];
        if ($this->has('mapping')) {
            $raw['mapping'] = (array) $this->input('mapping', []);
        }

        return app(StockPermitImportAdapter::class)->canonicalOptions($raw);
    }
}
