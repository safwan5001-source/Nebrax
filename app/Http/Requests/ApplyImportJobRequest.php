<?php

namespace App\Http\Requests;

use App\Services\ProductImportService;
use App\Support\ProductImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات ترحيل قطعة واحدة من تشغيلة استيراد دائم (PR-DUR-2/3). لا ملف هنا —
 * التشغيلة مخزَّنة أصلاً منذ الرفع (PR-DUR-1)؛ لا إعادة رفع لأي قطعة. لا
 * `batch_offset` في هذا العقد أصلاً: المؤشّر مصدره الوحيد `processed_rows`
 * المخزَّن على التشغيلة تحت قفلٍ، لا الطلب — عميلٌ لا يتحكّم بمؤشّر الاستئناف.
 *
 * `price_list_id` (PR-DUR-3) بنيويٌّ فقط هنا (uuid اختياري) — التحقق
 * التجاري الفعلي (موجودة ضمن نطاق المؤسسة، نشطة) في
 * `ProductWorkbookService::resolveActivePriceList()` وحدها، يُستدعى من
 * `ImportJobService::runProductWorkbookChunk()` حيّاً على كل استدعاء.
 * يُتجاهل كلياً لمجال `product_catalog`.
 */
class ApplyImportJobRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
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
            'batch_size' => ['sometimes', 'integer', 'min:1', 'max:'.ProductImportService::APPLY_BATCH_SIZE],
            'price_list_id' => ['sometimes', 'nullable', 'uuid'],
        ];
    }

    public function messages(): array
    {
        return [
            'mode.in' => 'اختر وضع الإنشاء أو التحديث أو الدمج.',
            'blank_policy.in' => 'سياسة القيم الفارغة غير صالحة.',
            'master_data_policy.in' => 'سياسة البيانات الأساسية غير صالحة.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد المنتجات.',
            'price_list_id.uuid' => 'معرّف قائمة السعر غير صالح.',
        ];
    }

    /**
     * خيارات التطبيق كما تصل من الطلب — تُجمَّد على التشغيلة عند أول قطعة
     * فقط (`ImportJobService::applyNextChunk`)؛ القطع اللاحقة تتجاهل هذه
     * القيم وتستعمل النسخة المجمَّدة، فلا يعيد تفسير حالة واجهة تغيّرت.
     *
     * @return array<string, mixed>
     */
    public function applyOptions(): array
    {
        $options = [
            'mode' => $this->string('mode', ProductImportService::MODE_CREATE)->toString(),
            'blank_policy' => $this->string('blank_policy', ProductImportService::BLANK_IGNORE)->toString(),
            'master_data_policy' => $this->string('master_data_policy', ProductImportService::MASTER_DATA_TEXT)->toString(),
        ];

        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        if ($this->has('batch_size')) {
            $options['batch_size'] = (int) $this->input('batch_size');
        }

        if ($this->has('price_list_id')) {
            $options['price_list_id'] = $this->string('price_list_id')->toString() ?: null;
        }

        return $options;
    }
}
