<?php

namespace App\Http\Requests;

use App\Services\ExpenseImportService;
use App\Services\PurchaseImportService;
use App\Services\ImportJobAccess;
use App\Services\ProductImportService;
use App\Services\PartnerImportService;
use App\Services\PriceListItemImportService;
use App\Services\ProductTaxonomyImportService;
use App\Services\StocktakeCountImportService;
use App\Services\UnitTemplateImportService;
use App\Support\ExpenseImportFields;
use App\Support\PurchaseImportFields;
use App\Support\InventoryOpeningFields;
use App\Support\PartnerImportFields;
use App\Support\PriceListItemImportFields;
use App\Support\ProductTaxonomyImportFields;
use App\Support\StocktakeCountImportFields;
use App\Support\UnitTemplateImportFields;
use App\Support\ProductImportFields;
use App\Support\ImportJobDomain;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreImportJobRequest extends FormRequest
{
    /**
     * IMP-H1-S1 — صلاحية الإدارة + قدرة **مجال** التشغيلة، قبل أي فحص لمحتوى الملف (يجري `authorize` قبل
     * التحقق). مجالٌ غير معروف يُحاسَب على بوابات كتالوج المنتجات (سلوك المسار القديم نفسه) ثم يفشل
     * التحقق 422 — فلا يتحوّل 403 إلى 422 لمن لا يملك أي صلاحية.
     */
    public function authorize(): bool
    {
        $domain = $this->input('domain');
        // غير نصّي (`domain[]=x`) أو غير معروف: يُحاسَب على بوابات المنتجات ثم يفشل التحقق 422 — لا 500.
        $known = is_string($domain) && in_array($domain, ImportJobDomain::values(), true) ? $domain : ImportJobDomain::PRODUCT_CATALOG;
        app(ImportJobAccess::class)->assertManage($this, $known);

        return true;
    }

    public function rules(): array
    {
        return [
            // نفس قواعد `ImportProductsRequest` حرفياً — سقف حجم وامتداد موحّد
            // عبر كل أسطح الاستيراد. `mimes` سقفٌ عامٌّ يشمل امتدادات كل
            // المجالات معاً؛ التضييق لكل مجال (XLSX حصراً لـ`product_workbook`،
            // مطابقاً `ProductWorkbookImportRequest` حرفياً) في الإغلاق أدناه.
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:5120', function ($attribute, $value, $fail) {
                $domain = $this->input('domain');
                $domain = is_string($domain) ? $domain : ''; // `domain[]=x` يفشل بـ422 (قاعدة `in`) لا 500.
                $extension = strtolower((string) $value->getClientOriginalExtension());
                if ($domain === ImportJobDomain::PRODUCT_WORKBOOK && $extension !== 'xlsx') {
                    $fail('مصنّف Products/Barcodes/Unit Prices يجب أن يكون بصيغة XLSX.');
                }
            }],
            'domain' => ['required', Rule::in(ImportJobDomain::values())],
            'media_archive' => ['sometimes', 'nullable', 'file', 'mimes:zip', 'max:51200', function ($attribute, $value, $fail) {
                if ($this->input('domain') !== ImportJobDomain::PRODUCT_CATALOG) {
                    $fail('أرشيف صور المنتجات متاح لاستيراد كتالوج المنتجات فقط.');
                }
            }],
            'idempotency_key' => ['sometimes', 'nullable', 'string', 'max:191'],
            // IMP-H1-S3b — ربط التنفيذ بمعاينته: المعرّف والبصمة معاً أو لا شيء، والخيارات **نفسها** التي أُرسلت إلى المعاينة.
            'preview_id' => [Rule::requiredIf(fn () => in_array($this->input('domain'), ImportJobDomain::PREVIEW_BOUND_ONLY, true)), 'required_with:preview_hash', 'nullable', 'uuid'],
            'preview_hash' => ['required_with:preview_id', 'nullable', 'string', 'size:64'],
            'options' => ['sometimes', 'nullable', 'array'],
            'options.mode' => ['sometimes', Rule::in([ProductImportService::MODE_CREATE, ProductImportService::MODE_UPDATE, ProductImportService::MODE_UPSERT])],
            'options.blank_policy' => ['sometimes', Rule::in([ProductImportService::BLANK_IGNORE, ProductImportService::BLANK_CLEAR])],
            'options.master_data_policy' => ['sometimes', Rule::in([ProductImportService::MASTER_DATA_ERROR, ProductImportService::MASTER_DATA_TEXT, ProductImportService::MASTER_DATA_CREATE])],
            'options.mapping' => ['sometimes', 'array', 'max:'.ProductImportService::MAX_COLUMNS],
            'options.mapping.*' => ['nullable', 'string', Rule::in(array_merge(ProductImportFields::keys(), InventoryOpeningFields::keys(), PartnerImportFields::keys(), ProductTaxonomyImportFields::allKeys(), PriceListItemImportFields::keys(), UnitTemplateImportFields::keys(), StocktakeCountImportFields::keys(), ExpenseImportFields::keys(), PurchaseImportFields::keys(), ['ignore']))],
            // IMP-H3-S2: النوع إلزامي لمجال الأطراف (يحدّد عميلاً أم مورّداً ولا يُستنتج من الملف) ويُرفض لغيره؛ فشلُ غيابه بعد الإنشاء كان سيظهر وقت التطبيق.
            'options.type' => [Rule::requiredIf(fn () => $this->input('domain') === ImportJobDomain::PARTNER_MASTER), Rule::in(PartnerImportService::TYPES)],
            'options.duplicate_signal_policy' => ['sometimes', Rule::in([PartnerImportService::SIGNAL_ERROR, PartnerImportService::SIGNAL_SKIP, PartnerImportService::SIGNAL_WARN])],
            // IMP-H4-S5: النوع (تصنيف/علامة) إلزامي لمجال التصنيفات؛ سياسة الآباء للتصنيفات؛ سياسة القوالب القائمة؛ وقائمة السعر إلزامية لمجال عناصرها.
            'options.kind' => [Rule::requiredIf(fn () => $this->input('domain') === ImportJobDomain::PRODUCT_TAXONOMY), Rule::in(ProductTaxonomyImportFields::KINDS)],
            'options.parent_policy' => ['sometimes', Rule::in([ProductTaxonomyImportService::PARENT_ERROR, ProductTaxonomyImportService::PARENT_CREATE])],
            'options.existing_policy' => ['sometimes', Rule::in([UnitTemplateImportService::EXISTING_ERROR, UnitTemplateImportService::EXISTING_SKIP])],
            'options.price_list_id' => $this->input('domain') === ImportJobDomain::PRICE_LIST_ITEMS ? ['required', 'uuid'] : ['sometimes', 'nullable', 'uuid'],
            // IMP-H7-S1b: الجرد المستهدف إلزامي لمجال أعداد الجرد (مجمَّد مع المعاينة)، وسياسة العدّ القائم.
            'options.stocktake_id' => $this->input('domain') === ImportJobDomain::STOCKTAKE_COUNT ? ['required', 'uuid'] : ['sometimes', 'nullable', 'uuid'],
            'options.existing_count_policy' => ['sometimes', Rule::in([StocktakeCountImportService::POLICY_ERROR, StocktakeCountImportService::POLICY_OVERWRITE, StocktakeCountImportService::POLICY_SKIP])],
            // IMP-H5-S2: سياسات مسودات المصروفات (تُجمَّد مع المعاينة)؛ الحساب الافتراضي حسابٌ في المؤسسة يُتحقَّق منه وقت المعاينة/التنفيذ.
            'options.reference_policy' => ['sometimes', Rule::in([ExpenseImportService::REFERENCE_OPTIONAL, ExpenseImportService::REFERENCE_REQUIRED])],
            'options.default_account_id' => ['sometimes', 'nullable', 'uuid'],
            'options.default_payment_method' => ['sometimes', Rule::in(ExpenseImportFields::PAYMENT_METHODS)],
            // null/فارغ = «تفضيل المؤسسة» لمجال المشتريات (يحسمه المحوّل قانونياً)؛ بقية المجالات تعامله غياباً كما كان الغياب.
            'options.default_tax_rate' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100'],
            'options.confirmed_repeat_rows' => ['sometimes', 'array', 'max:'.ExpenseImportService::MAX_ROWS],
            'options.confirmed_repeat_rows.*' => ['integer', 'min:2'],
            // IMP-H5-S4a: سياسات مسودات المشتريات (تُجمَّد مع المعاينة)؛ المورّد الافتراضي والمستودع يُتحقَّق منهما وقت المعاينة/التنفيذ.
            'options.default_supplier_id' => ['sometimes', 'nullable', 'uuid'],
            'options.default_payment_type' => ['sometimes', 'nullable', Rule::in(PurchaseImportFields::PAYMENT_TYPES)],
            'options.tax_inclusive' => ['sometimes', 'nullable', 'boolean'],
            'options.warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'options.opening_date' => ['sometimes', 'date_format:Y-m-d'],
            'options.allow_zero_cost' => ['sometimes', 'boolean'],
            // IMP-H7-S3: رأس إذن المخزن (يُجمَّد مع المعاينة)؛ النوع إلزامي لمجاله ولا افتراضي له.
            'options.permit_type' => [Rule::requiredIf(fn () => $this->input('domain') === ImportJobDomain::STOCK_PERMIT_IMPORT), Rule::in(\App\Models\StockPermit::TYPES)],
            'options.target_warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'options.permit_date' => ['sometimes', 'date_format:Y-m-d'],
            'options.reason' => ['sometimes', 'nullable', 'string', 'max:255'],
            'options.notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            'options.apply_product_images' => ['sometimes', 'boolean'],
            'options.approve_existing_media_updates' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * خيارات الإنشاء كما أُرسلت (تُحوَّل قانونياً في الخدمة). الحقول المنطقية تصل نصّاً في multipart فتُحوَّل هنا.
     *
     * @return array<string, mixed>|null
     */
    public function creationOptions(): ?array
    {
        $options = $this->input('options');
        if (! is_array($options)) {
            return null;
        }
        foreach (['allow_zero_cost', 'apply_product_images', 'approve_existing_media_updates'] as $key) {
            if (array_key_exists($key, $options)) {
                $options[$key] = filter_var($options[$key], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }
        }

        return $options;
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'domain.required' => 'حدّد مجال الاستيراد.',
            'domain.in' => 'مجال الاستيراد غير مدعوم.',
            'preview_id.required' => 'هذا المجال يتطلب معاينة الملف أولاً ثم إنشاء التشغيلة من نتيجتها.',
            'media_archive.mimes' => 'أرشيف الصور يجب أن يكون ملف ZIP صالحاً.',
            'media_archive.max' => 'حجم أرشيف الصور يجب ألا يتجاوز 50 ميغابايت.',
        ];
    }
}
