<?php

namespace App\Http\Requests;

use App\Services\ImportJobAccess;
use App\Services\PartnerImportService;
use App\Services\ProductTaxonomyImportService;
use App\Services\UnitTemplateImportService;
use App\Services\ProductImportService;
use App\Support\InventoryOpeningFields;
use App\Support\PartnerImportFields;
use App\Support\PriceListItemImportFields;
use App\Support\ProductTaxonomyImportFields;
use App\Support\UnitTemplateImportFields;
use App\Support\ProductImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات ترحيل قطعة واحدة من تشغيلة استيراد دائم (PR-DUR-2/3/4). لا ملف هنا —
 * التشغيلة مخزَّنة أصلاً منذ الرفع (PR-DUR-1)؛ لا إعادة رفع لأي قطعة. لا
 * `batch_offset` في هذا العقد أصلاً: المؤشّر مصدره الوحيد `processed_rows`
 * المخزَّن على التشغيلة تحت قفلٍ، لا الطلب — عميلٌ لا يتحكّم بمؤشّر الاستئناف.
 *
 * **عقدٌ مشتركٌ فضفاض عمداً بين المجالات الثلاثة** — كل حقلٍ هنا بنيويٌّ فقط
 * (نوعه/شكله)، والتحقق التجاري الفعلي في خدمة المجال المستهدف وحدها، حيّاً
 * على كل استدعاء:
 * - `mode`/`blank_policy`/`master_data_policy`/`batch_size` — `product_catalog` فقط.
 * - `price_list_id` (PR-DUR-3) — `product_workbook` فقط، عبر
 *   `ProductWorkbookService::resolveActivePriceList()`.
 * - `opening_date`/`allow_zero_cost`/`notes` (PR-DUR-4) — `inventory_opening`
 *   فقط، عبر `InventoryOpeningImportService::options()` نفسها.
 * - `mapping` مشترك بين الثلاثة؛ مفاتيحه المقبولة هنا اتحاد معجمَي
 *   `ProductImportFields`/`InventoryOpeningFields` معاً (`product_workbook`
 *   يعيد استعمال معجم `ProductImportFields` لورقة Products) — القيمة التي
 *   لا تخصّ مجال هذه التشغيلة فعلاً تُرفض لاحقاً بخدمة ذلك المجال، لا هنا.
 * تمرير `ImportDomainAdapter::applyChunk()` يمرّر لكل خدمةٍ حقولها
 * فقط (`array_intersect_key`) فلا يصلها ما لا يعنيها أصلاً.
 */
class ApplyImportJobRequest extends FormRequest
{
    /**
     * IMP-H1-S1 — أرضية الصلاحية فقط (إدارة أي مجال استيراد) قبل التحقق من الخيارات؛ البوابة الفعلية لمجال التشغيلة
     * (صلاحية + قدرة) في المتحكّم بعد البحث عنها — مرة واحدة. تشغيلة غير موجودة/من مستأجر آخر: 404 هناك.
     */
    public function authorize(): bool
    {
        app(ImportJobAccess::class)->assertManageAny($this);

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
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(
                ProductImportFields::keys(),
                InventoryOpeningFields::keys(),
                PartnerImportFields::keys(),
                ProductTaxonomyImportFields::allKeys(),
                PriceListItemImportFields::keys(),
                UnitTemplateImportFields::keys(),
                ['ignore']
            ))],
            // IMP-H3-S2 — خياراتا `partner_master`: النوع (عميل/مورّد) وسياسة إشارات التكرار.
            'type' => ['sometimes', Rule::in(PartnerImportService::TYPES)],
            'duplicate_signal_policy' => ['sometimes', Rule::in([PartnerImportService::SIGNAL_ERROR, PartnerImportService::SIGNAL_SKIP, PartnerImportService::SIGNAL_WARN])],
            // IMP-H4-S5 — خيارات `product_taxonomy` (النوع وسياسة الآباء) و`unit_templates` (سياسة القوالب القائمة).
            'kind' => ['sometimes', Rule::in(ProductTaxonomyImportFields::KINDS)],
            'parent_policy' => ['sometimes', Rule::in([ProductTaxonomyImportService::PARENT_ERROR, ProductTaxonomyImportService::PARENT_CREATE])],
            'existing_policy' => ['sometimes', Rule::in([UnitTemplateImportService::EXISTING_ERROR, UnitTemplateImportService::EXISTING_SKIP])],
            'batch_size' => ['sometimes', 'integer', 'min:1', 'max:'.ProductImportService::APPLY_BATCH_SIZE],
            'price_list_id' => ['sometimes', 'nullable', 'uuid'],
            'opening_date' => ['sometimes', 'date_format:Y-m-d'],
            'allow_zero_cost' => ['sometimes', 'boolean'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            'apply_product_images' => ['sometimes', 'boolean'],
            'approve_existing_media_updates' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'mode.in' => 'اختر وضع الإنشاء أو التحديث أو الدمج.',
            'blank_policy.in' => 'سياسة القيم الفارغة غير صالحة.',
            'master_data_policy.in' => 'سياسة البيانات الأساسية غير صالحة.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد الاستيراد.',
            'price_list_id.uuid' => 'معرّف قائمة السعر غير صالح.',
            'opening_date.date_format' => 'تاريخ الرصيد الافتتاحي يجب أن يكون بصيغة YYYY-MM-DD.',
        ];
    }

    /**
     * الخيارات **الدلالية** التي أرسلها الطلب فعلاً (بلا افتراضات ولا `batch_size`) — تُقارَن بالمجمَّد في تشغيلةٍ مربوطةٍ
     * بمعاينة (IMP-H1-S3b): ما لم يُرسَل لا يُعدّ تغييراً.
     *
     * @return array<string, mixed>
     */
    public function explicitOptions(): array
    {
        $options = [];
        foreach (['mode', 'blank_policy', 'master_data_policy', 'opening_date', 'type', 'duplicate_signal_policy', 'kind', 'parent_policy', 'existing_policy'] as $key) {
            if ($this->has($key)) {
                $options[$key] = $this->string($key)->toString();
            }
        }
        // مطابقة فارغة = لا مطابقة مُرسَلة (المعاينة multipart لا تستطيع إرسال مصفوفة فارغة أصلاً): لا تُعدّ تغييراً للمجمَّد.
        if ($this->has('mapping') && (array) $this->input('mapping', []) !== []) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }
        if ($this->has('price_list_id')) {
            $options['price_list_id'] = $this->string('price_list_id')->toString() ?: null;
        }
        if ($this->has('notes')) {
            $options['notes'] = $this->input('notes');
        }
        foreach (['allow_zero_cost', 'apply_product_images', 'approve_existing_media_updates'] as $key) {
            if ($this->has($key)) {
                $options[$key] = $this->boolean($key);
            }
        }

        return $options;
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

        if ($this->has('opening_date')) {
            $options['opening_date'] = (string) $this->input('opening_date');
        }
        foreach (['type', 'duplicate_signal_policy', 'kind', 'parent_policy', 'existing_policy'] as $key) {
            if ($this->has($key)) {
                $options[$key] = $this->string($key)->toString();
            }
        }
        if ($this->has('allow_zero_cost')) {
            $options['allow_zero_cost'] = $this->boolean('allow_zero_cost');
        }
        if ($this->has('notes')) {
            $options['notes'] = $this->input('notes');
        }
        if ($this->has('apply_product_images')) {
            $options['apply_product_images'] = $this->boolean('apply_product_images');
        }
        if ($this->has('approve_existing_media_updates')) {
            $options['approve_existing_media_updates'] = $this->boolean('approve_existing_media_updates');
        }

        return $options;
    }
}
