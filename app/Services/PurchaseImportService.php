<?php

namespace App\Services;

use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Warehouse;
use App\Services\Accounting\ComputesLineTax;
use App\Services\Accounting\PurchaseService;
use App\Support\DuplicateDocumentException;
use App\Support\ImportPlanDriftException;
use App\Support\ImportUnitFailureException;
use App\Support\ProductImportValueNormalizer as Normalizer;
use App\Support\PurchaseImportFields as Fields;
use App\Support\Settings;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * استيراد فواتير المشتريات — IMP-H5-S3b (خدمة فقط؛ لا مجال مهمة ولا مسارات بعد: S4). يحلّل الملف ويطابق ويعاين ويكتب **فاتورةً فاتورة** عبر `PurchaseService::create` وحده:
 * **الوحدة فاتورة المورّد كلها** (مجموعة صفوف بـ مورّد ‖ رقم فاتورته المطبَّع) → **مسودة** مشتريات واحدة بسطورها. لا ترحيل ولا قيد ولا حركة مخزون ولا سند صرف هنا أبداً.
 *
 *  - **رقم فاتورة المورّد إلزامي** (هويتها): صفٌّ بلا مورّد أو بلا رقم صالح خطأ صف ووحدةٌ مستقلة معطوبة؛ لا يُجمَّع تحت `(مورّد, null)` أبداً (كان سيدمج فواتير مختلفة).
 *  - **الإجماليات مشتقّة لا مُدخلة:** الخدمة تشتقّها من السطور؛ والمستورد يشتقّ الإجمالي نفسه بالمنطق نفسه (`ComputesLineTax`) ليقارنه بعمود `invoice_total` الاختياري — الاختلاف **خطأ صف**
 *    لا يُكتب ولا يستبدل أبداً.
 *  - **رأس الفاتورة** (تاريخ/استحقاق/نوع دفع/ملاحظات/إجمالي الملف) من أول صفٍّ يحمله في المجموعة؛ صفٌّ لاحق يخالفه خطأ صريح (لا فوز صامت).
 *  - **منع التكرار** (`import_document_reservations`، S1a/S3a): الفاتورة تحجز هويتها في `PurchaseService::create`؛ قبل الكتابة يرى المستورد المشتريات القائمة للمورّد برقمها المطبَّع ويرفضها
 *    (لا تأكيد تكرار في هذا المجال: الهوية تامة لا تقريبية). تنازعٌ متزامن عند الكتابة يعود فشل وحدةٍ مسمّاة.
 *  - **المراجع بمعرّفات موثوقة:** المورّد بكوده (طرف مورّد نشط) أو مورّد افتراضي للتشغيلة، المنتج بمعرّف نبراكس/الرمز/الباركود (يتقاطع المذكور في منتج نشط واحد؛ **الاسم ليس معرّفاً**)،
 *    المستودع من خيار التشغيلة. لا إنشاء تلقائي لأي مرجع. منتجٌ متعدد الخيارات خطأ صف (الاستيراد لا يحدّد متغيّراً).
 *  - **السياسات لكل تشغيلة** (لا سلوك واحد مفروض): `default_supplier_id`، `default_payment_type`، `default_tax_rate`، `tax_inclusive`، `warehouse_id`؛ الغياب = تفضيل المؤسسة في الخدمة.
 *  - النافذة (`batch_offset`/`batch_size`) تُحسب على **الوحدات** (الفواتير) لا الصفوف: وحدةٌ لا تُجزَّأ عبر قطعتين.
 */
class PurchaseImportService
{
    use ComputesLineTax;

    public const MAX_ROWS = 2000;
    public const DURABLE_MAX_ROWS = ProductImportService::DURABLE_MAX_ROWS;
    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;
    private const PREVIEW_UNIT_LIMIT = 200;
    private const LOOKUP_CHUNK = 400;
    private const MAX_MINOR = 100000000000;
    /** سقف إجمالي الفاتورة المشتق: ضريبة الخدمة تضرب (ضريبة × أساس) في int64، فتجاوزه يفيض (~7.8 مليار هللة)؛ 5 مليارات هللة (50 مليون ريال) هامش آمن. */
    private const MAX_INVOICE_MINOR = 5000000000;

    /** رموز خطأ الخلية → رسالتها. */
    private const CELL_ERRORS = [
        'too_long' => 'القيمة تتجاوز الحد المسموح.',
        'invalid_date' => 'التاريخ غير صالح (استخدم YYYY-MM-DD أو DD/MM/YYYY).',
        'invalid_money' => 'المبلغ يجب أن يكون رقماً بمنزلتين عشريتين على الأكثر (الفاصلة العشرية نقطة، والفاصلة للآلاف).',
        'money_out_of_range' => 'المبلغ يتجاوز النطاق المالي الآمن.',
        'invalid_integer' => 'القيمة يجب أن تكون عدداً صحيحاً.',
        'integer_out_of_range' => 'القيمة خارج النطاق المسموح.',
        'invalid_enum' => 'نوع الدفع يقبل نقد أو آجل (cash / credit).',
    ];

    private const PAYMENT_ALIASES = [
        'نقد' => 'cash', 'نقدي' => 'cash', 'نقدا' => 'cash', 'كاش' => 'cash', 'cash' => 'cash',
        'آجل' => 'credit', 'اجل' => 'credit', 'ائتمان' => 'credit', 'credit' => 'credit', 'deferred' => 'credit',
    ];

    // ═══════════════════════════════════════════════════════════════
    //  العقد والقالب والفحص
    // ═══════════════════════════════════════════════════════════════

    /** @return list<array<string, mixed>> */
    public function fieldContract(): array
    {
        $contract = [];
        foreach (Fields::all() as $key => $field) {
            $contract[] = ['key' => $key, 'label_ar' => $field['label_ar'], 'label_en' => $field['label_en'], 'type' => $field['type'], 'required' => (bool) $field['required']];
        }

        return $contract;
    }

    public function template(): string
    {
        $example = static fn (array $values): array => array_map(static fn (string $key): string => $values[$key] ?? '', Fields::keys());

        return SpreadsheetWriter::csv(Fields::templateHeaders(), [
            $example(['supplier_code' => 'S-001', 'supplier_invoice_ref' => 'INV-2041', 'purchase_date' => '2026-10-01', 'due_date' => '2026-10-31', 'payment_type' => 'credit', 'sku' => 'CEM-50', 'quantity' => '10', 'unit_price' => '25.00', 'tax_rate' => '15']),
            $example(['supplier_code' => 'S-001', 'supplier_invoice_ref' => 'INV-2041', 'sku' => 'SAND-1', 'description' => 'رمل ناعم', 'quantity' => '4', 'unit_price' => '28.00', 'tax_rate' => '15']),
            $example(['supplier_code' => 'S-002', 'supplier_invoice_ref' => 'B-77', 'purchase_date' => '2026-10-03', 'payment_type' => 'cash', 'barcode' => '6281000000011', 'quantity' => '2', 'unit_price' => '100.00']),
        ]);
    }

    /** @return array{columns: list<array<string, mixed>>, total_rows: int, fields: list<array<string, mixed>>} */
    public function inspect(UploadedFile $file, int $maxRows = self::MAX_ROWS): array
    {
        $rows = $this->readFile($file, $maxRows);
        $headers = array_map('strval', $rows[0] ?? []);
        $mapping = Fields::autoMap($headers);
        $data = array_values(array_filter(array_slice($rows, 1), static fn (array $row): bool => ! ProductImportService::isBlankRow($row)));

        $columns = [];
        foreach ($headers as $index => $header) {
            $samples = [];
            foreach ($data as $row) {
                $value = trim((string) ($row[$index] ?? ''));
                if ($value !== '') {
                    $samples[] = mb_substr($value, 0, 60);
                }
                if (count($samples) >= 3) {
                    break;
                }
            }
            $columns[] = ['index' => $index, 'header' => $header, 'samples' => $samples, 'suggested_field' => $mapping[$index] ?? null];
        }

        return ['columns' => $columns, 'total_rows' => count($data), 'fields' => $this->fieldContract()];
    }

    // ═══════════════════════════════════════════════════════════════
    //  المعاينة والتطبيق
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function preview(UploadedFile $file, array $options, int $maxRows = self::MAX_ROWS): array
    {
        return $this->previewWithPlan($file, $options, $maxRows)['preview'];
    }

    /**
     * المعاينة مع خطّتها (رمز كل وحدة، مفتاحه رقم أول صف في الورقة، يُقارَن وقت التنفيذ ضد `plan_drift`).
     *
     * @param  array<string, mixed>  $options
     * @return array{preview: array<string, mixed>, plan: array<int, string>|null}
     */
    public function previewWithPlan(UploadedFile $file, array $options, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);
        $parsed = $this->parse($file, $resolved, $maxRows);
        $units = array_slice($parsed['units'], 0, self::PREVIEW_UNIT_LIMIT);

        $preview = [
            'default_supplier_id' => $resolved['default_supplier_id'], 'default_payment_type' => $resolved['default_payment_type'],
            'default_tax_rate' => $resolved['default_tax_rate'], 'tax_inclusive' => $resolved['tax_inclusive'], 'warehouse_id' => $resolved['warehouse_id'],
            'mapping' => $parsed['mapping'], 'total_rows' => $parsed['total_rows'], 'total_units' => $parsed['total_units'],
            'create_units' => $parsed['counters']['create'], 'warning_units' => $parsed['counters']['warning'], 'error_units' => $parsed['counters']['error'],
            'valid_units' => $parsed['total_units'] - $parsed['counters']['error'], 'invalid_units' => $parsed['counters']['error'],
            'create_total_minor' => $parsed['create_total_minor'],
            'units' => array_map(fn (array $unit): array => $this->unitSummary($unit), $units),
            'units_shown' => count($units), 'units_truncated' => count($parsed['units']) > count($units),
            'errors' => $parsed['errors'],
        ];

        $windowed = $resolved['batch_offset'] > 0 || $resolved['batch_size'] !== null;
        $plan = [];
        foreach ($windowed ? [] : $parsed['units'] as $unit) {
            $plan[(int) $unit['first_row']] = $this->planCode($unit);
        }

        return ['preview' => $preview, 'plan' => $windowed ? null : $plan];
    }

    /**
     * يكتب نافذة الوحدات مسوداتٍ في معاملة واحدة. الملف **كله** يُحلَّل (لتجميع الفواتير)، والكتابة لوحدات النافذة وحدها.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId = null, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);
        $this->assertWarehouseAccess($resolved['warehouse_id'], $userId);

        return DB::transaction(function () use ($file, $resolved, $userId, $maxRows): array {
            $parsed = $this->parse($file, $resolved, $maxRows);

            if ($parsed['total_rows'] === 0) {
                throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
            }
            if ($resolved['expected_plan'] !== null) {
                foreach ($parsed['units'] as $unit) {
                    $planned = $resolved['expected_plan'][(int) $unit['first_row']] ?? null;
                    $live = $this->planCode($unit);
                    if ($planned === null || $planned !== $live) {
                        throw new ImportPlanDriftException((int) $unit['first_row'], $planned, $live);
                    }
                }
            }

            if ($parsed['counters']['error'] > 0) {
                $failures = $this->unitFailures($parsed['units']);
                throw new ImportUnitFailureException($this->failureSummary('لا يمكن تطبيق الاستيراد قبل معالجة الأخطاء الظاهرة في المعاينة.', $failures), $failures);
            }

            $purchases = app(PurchaseService::class);
            $created = 0;
            $results = [];
            $failures = [];
            foreach ($parsed['units'] as $unit) {
                try {
                    // نقطة حفظ لكل فاتورة: تنازعٌ متزامن يُرمى بعد أن تكون معاملة PostgreSQL ما زالت صالحة، ثم تتراجع القطعة كلها بفشل وحدتها المسمّاة.
                    DB::transaction(fn () => $purchases->create(
                        $unit['header'] + ['created_by' => $userId],
                        $unit['items'],
                        ['source' => DocumentDuplicateReservationService::SOURCE_STANDARD],
                    ));
                    $created++;
                } catch (DuplicateDocumentException) {
                    $failures[] = ['ordinal' => (int) $unit['ordinal'], 'code' => 'duplicate_document', 'message' => $this->unitLabel($unit).'فاتورة المورّد بهذا الرقم أُنشئت للتو من مسار آخر.'];
                } catch (\Illuminate\Database\QueryException $e) {
                    throw $e;   // خطأ قاعدة بيانات: لا نصّه (SQL/قيم) في رسالة وحدة؛ تفشل القطعة كلها وتتراجع.
                } catch (RuntimeException $e) {
                    $failures[] = ['ordinal' => (int) $unit['ordinal'], 'code' => 'purchase_create_failed', 'message' => $this->unitLabel($unit).$e->getMessage()];
                }
                $results[] = $this->unitSummary($unit);
            }
            if ($failures !== []) {
                throw new ImportUnitFailureException($this->failureSummary('تعذّر إنشاء بعض الفواتير.', $failures), $failures);
            }

            return [
                'created' => $created, 'updated' => 0, 'skipped' => 0,
                'total_rows' => $parsed['total_rows'], 'total_units' => $parsed['total_units'],
                'batch_offset' => $resolved['batch_offset'], 'batch_size' => $resolved['batch_size'],
                'results' => $results,
            ];
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  الخيارات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array{default_supplier_id: ?string, default_payment_type: ?string, default_tax_rate: ?int, tax_inclusive: ?bool, warehouse_id: ?string, mapping: array<int, string|null>|null, batch_offset: int, batch_size: ?int, expected_plan: array<int, string>|null}
     */
    public function options(array $options): array
    {
        foreach (['default_supplier_id', 'default_payment_type', 'warehouse_id'] as $scalar) {
            if (isset($options[$scalar]) && ! is_scalar($options[$scalar])) {
                throw new RuntimeException('خيار استيراد المشتريات غير صالح.');
            }
        }
        $supplier = isset($options['default_supplier_id']) && $options['default_supplier_id'] !== '' ? mb_strtolower((string) $options['default_supplier_id'], 'UTF-8') : null;
        if ($supplier !== null && ! Str::isUuid($supplier)) {
            throw new RuntimeException('المورّد الافتراضي غير صالح.');
        }
        $warehouse = isset($options['warehouse_id']) && $options['warehouse_id'] !== '' ? mb_strtolower((string) $options['warehouse_id'], 'UTF-8') : null;
        if ($warehouse !== null && ! Str::isUuid($warehouse)) {
            throw new RuntimeException('المستودع غير صالح.');
        }
        $payment = isset($options['default_payment_type']) && $options['default_payment_type'] !== '' ? (string) $options['default_payment_type'] : null;
        if ($payment !== null && ! in_array($payment, Fields::PAYMENT_TYPES, true)) {
            throw new RuntimeException('نوع الدفع الافتراضي غير صالح.');
        }
        $tax = $options['default_tax_rate'] ?? null;
        if ($tax === '') {
            $tax = null;
        }
        if ($tax !== null && (! is_numeric($tax) || (int) $tax != $tax || (int) $tax < 0 || (int) $tax > 100)) {
            throw new RuntimeException('نسبة الضريبة الافتراضية يجب أن تكون عدداً صحيحاً بين 0 و100.');
        }
        $inclusive = $options['tax_inclusive'] ?? null;
        if ($inclusive === '') {
            $inclusive = null;
        }
        if ($inclusive !== null) {
            $inclusive = filter_var($inclusive, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($inclusive === null) {
                throw new RuntimeException('خيار «الأسعار شاملة الضريبة» غير صالح.');
            }
        }

        $mapping = null;
        if (isset($options['mapping']) && is_array($options['mapping'])) {
            $mapping = [];
            foreach ($options['mapping'] as $index => $key) {
                if (! is_numeric($index)) {
                    continue;
                }
                $key = $key === null || $key === '' || $key === 'ignore' ? null : (string) $key;
                if ($key !== null && Fields::get($key) === null) {
                    throw new RuntimeException('أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد المشتريات.');
                }
                $mapping[(int) $index] = $key;
            }
        }

        $plan = isset($options['expected_plan']) && is_array($options['expected_plan']) ? $options['expected_plan'] : null;

        return [
            'default_supplier_id' => $supplier, 'default_payment_type' => $payment, 'default_tax_rate' => $tax === null ? null : (int) $tax,
            'tax_inclusive' => $inclusive, 'warehouse_id' => $warehouse, 'mapping' => $mapping,
            'batch_offset' => max(0, (int) ($options['batch_offset'] ?? 0)),
            'batch_size' => isset($options['batch_size']) ? max(1, (int) $options['batch_size']) : null, 'expected_plan' => $plan,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  التحليل
    // ═══════════════════════════════════════════════════════════════

    /** @return array<int, array<int, string>> */
    private function readFile(UploadedFile $file, int $maxRows): array
    {
        $extension = strtolower((string) ($file->getClientOriginalExtension() ?: $file->extension()));
        if (! SpreadsheetReader::isSupportedExtension($extension)) {
            throw new RuntimeException('صيغة الملف غير مدعومة. استخدم CSV أو XLSX.');
        }

        return SpreadsheetReader::read((string) $file->getRealPath(), $extension, $maxRows, self::MAX_COLUMNS);
    }

    /**
     * @param  array<string, mixed>  $options  ناتج `options()`
     * @return array{units: list<array<string, mixed>>, total_rows: int, total_units: int, mapping: array<int, string|null>, counters: array<string, int>, errors: list<array<string, mixed>>, create_total_minor: int}
     */
    private function parse(UploadedFile $file, array $options, int $maxRows): array
    {
        ['entries' => $entries, 'mapping' => $mapping] = $this->loadEntries($file, $options, $maxRows);

        // 3) التجميع في وحدات (فواتير) بترتيب الظهور الأول.
        $units = $this->group($entries, $options);

        // 4) النافذة وحدها تُقارَن بالمشتريات القائمة وتُصنَّف.
        $total = count($units);
        $window = array_slice($units, $options['batch_offset'], $options['batch_size']);
        $this->matchExisting($window);

        $counters = ['create' => 0, 'warning' => 0, 'error' => 0];
        $errors = [];
        $createTotal = 0;
        foreach ($window as &$unit) {
            $messages = [];
            foreach ($unit['entries'] as $entry) {
                foreach ($entry['messages'] as $message) {
                    $messages[$message] = $message;
                }
            }
            $unit['messages'] = array_values($messages);
            $unit['valid'] = $unit['messages'] === [];
            $unit['action'] = $unit['valid'] ? 'create' : 'error';
            $unit['status'] = ! $unit['valid'] ? 'error' : ($unit['warnings'] !== [] ? 'warning' : 'ok');
            $counters[$unit['action']]++;
            if ($unit['valid']) {
                $createTotal += (int) $unit['total_minor'];
            } else {
                $errors[] = ['row' => $unit['first_row'], 'messages' => $unit['messages']];
            }
            if ($unit['warnings'] !== [] && $unit['valid']) {
                $counters['warning']++;
            }
        }
        unset($unit);

        return ['units' => $window, 'total_rows' => count($entries), 'total_units' => $total, 'mapping' => $mapping, 'counters' => $counters, 'errors' => $errors, 'create_total_minor' => $createTotal];
    }

    /**
     * قراءة الملف وتطبيع كل صفوفه وحلّ مراجعه (مورّد/منتج/مستودع). مشتركة بين التحليل الكامل وعدّ الوحدات.
     *
     * @param  array<string, mixed>  $options
     * @return array{entries: list<array<string, mixed>>, mapping: array<int, string|null>}
     */
    private function loadEntries(UploadedFile $file, array $options, int $maxRows): array
    {
        $raw = $this->readFile($file, $maxRows);
        if ($raw === []) {
            throw new RuntimeException('الملف فارغ.');
        }
        $headers = array_map('strval', $raw[0]);
        $mapping = $options['mapping'] ?? Fields::autoMap($headers);
        $this->assertMapping($mapping, $options);

        // 1) كل الصفوف الفعلية: تطبيعٌ بلا قاعدة بيانات.
        $entries = [];
        foreach (array_slice($raw, 1, null, true) as $sheetIndex => $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $entry = $this->normalizeRow($values, $mapping);
            $entry['row'] = $sheetIndex + 1;
            $entry['codes'] = $entry['errors'];
            $entry['messages'] = array_map(fn (string $code): string => $this->message($code), $entry['errors']);
            // صفٌّ أعرض من صف العناوين تسقط قيمةٌ منه صامتةً — أخطر من خطأ صريح.
            if (count($values) > count($headers)) {
                $this->addIssue($entry, 'row_wider_than_header', 'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.');
            }
            $entries[] = $entry;
        }

        // 2) المراجع (مورّد/منتج) لكل الملف بدفعات + مستودع التشغيلة.
        $this->assertWarehouse($options);
        $this->resolveReferences($entries, $options);

        return ['entries' => $entries, 'mapping' => $mapping];
    }

    /**
     * عدد وحدات (فواتير) الملف بالخيارات المجمَّدة نفسها — يعيد المحوّل الدائم حسابه عند أول ترحيل لأن `row_count` وقت الفحص يُعدّ صفوفاً بلا مطابقة أعمدة ولا مورّد افتراضي.
     *
     * @param  array<string, mixed>  $options
     */
    public function unitCount(UploadedFile $file, array $options, int $maxRows = self::DURABLE_MAX_ROWS): int
    {
        ['entries' => $entries] = $this->loadEntries($file, $this->options($options), $maxRows);

        return count($this->group($entries, $this->options($options), false));
    }

    /** @param array<int, string|null> $mapping @param array<string, mixed> $options */
    private function assertMapping(array $mapping, array $options): void
    {
        $chosen = array_values(array_filter($mapping, static fn ($key): bool => $key !== null));
        if (count($chosen) !== count(array_unique($chosen))) {
            throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
        }
        foreach (['supplier_invoice_ref' => 'رقم فاتورة المورّد', 'purchase_date' => 'تاريخ الفاتورة', 'quantity' => 'الكمية', 'unit_price' => 'سعر الوحدة'] as $key => $label) {
            if (! in_array($key, $chosen, true)) {
                throw new RuntimeException("الاستيراد يحتاج عمود «{$label}».");
            }
        }
        if (array_intersect(['product_id', 'sku', 'barcode'], $chosen) === []) {
            throw new RuntimeException('الاستيراد يحتاج عمود تعريف المنتج: رمز الصنف أو الباركود أو معرّف نبراكس.');
        }
        if (! in_array('supplier_code', $chosen, true) && $options['default_supplier_id'] === null) {
            throw new RuntimeException('حدّد عمود «كود المورّد» أو اختر مورّداً افتراضياً للتشغيلة.');
        }
    }

    /**
     * المستودع المحدَّد يجب أن يكون ضمن صلاحيات من ينفّذ (مخزن وفرعه) — مثل `ApiController::assertWarehouseAllowed` في `POST /purchases`. بلا فاعل (مسار نظامي) لا فحص،
     * وبفاعل مجهول (حُذف) يُرفض مغلقاً. تُستدعى من المعاينة (المتحكّم) ومن كل قطعة تنفيذ.
     */
    public function assertWarehouseAccess(?string $warehouseId, ?string $userId): void
    {
        if ($warehouseId === null || $userId === null) {
            return;
        }
        $user = \App\Models\User::query()->find($userId);
        $warehouse = Warehouse::query()->whereKey($warehouseId)->first();
        if ($user === null || $warehouse === null
            || ! $user->canAccessWarehouse($warehouse->id)
            || ($warehouse->branch_id !== null && ! $user->canAccessBranch($warehouse->branch_id))) {
            throw new RuntimeException('هذا المستودع خارج نطاق صلاحياتك.');
        }
    }

    private function assertWarehouse(array $options): void
    {
        if ($options['warehouse_id'] !== null
            && ! Warehouse::query()->whereKey($options['warehouse_id'])->where('is_active', true)->exists()) {
            throw new RuntimeException('المستودع المحدَّد غير موجود أو معطّل.');
        }
    }

    /**
     * @param  array<int, string>  $values
     * @param  array<int, string|null>  $mapping
     * @return array<string, mixed>
     */
    private function normalizeRow(array $values, array $mapping): array
    {
        $present = [];
        $errors = [];
        foreach ($mapping as $index => $key) {
            if ($key === null) {
                continue;
            }
            $text = trim((string) ($values[$index] ?? ''));
            if ($text === '') {
                continue;   // الخلية الفارغة = غائبة (تأخذ الافتراضي أو يُطلب الحقل لاحقاً)
            }
            [$value, $error] = $this->normalizeCell($key, $text);
            if ($error !== null) {
                $errors[] = $error.':'.$key;
                continue;
            }
            $present[$key] = $value;
        }

        return ['values' => $present, 'errors' => $errors, 'refs' => []];
    }

    /** @return array{0: mixed, 1: ?string} */
    private function normalizeCell(string $key, string $text): array
    {
        $field = Fields::get($key);
        $max = (int) ($field['max'] ?? 255);

        return match ($field['type']) {
            Fields::TYPE_DATE => $this->date($text),
            Fields::TYPE_MONEY => $this->money($text),
            Fields::TYPE_INTEGER => Normalizer::integer($text, (int) ($field['min'] ?? 0), (int) ($field['max'] ?? 100)),
            Fields::TYPE_ENUM => $this->paymentType($text),
            default => mb_strlen($text) > $max ? [null, 'too_long'] : [$text, null],
        };
    }

    /** @return array{0: ?string, 1: ?string} */
    private function date(string $text): array
    {
        $value = trim(Normalizer::digits($text));
        $year = $month = $day = null;
        if (preg_match('/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T].*)?$/', $value, $m) === 1) {
            [, $year, $month, $day] = $m;
        } elseif (preg_match('/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/', $value, $m) === 1) {
            [, $day, $month, $year] = $m;   // اليوم أولاً (العرف السعودي)، لا شهر/يوم
        } elseif (preg_match('/^\d{5}(?:\.\d+)?$/', $value) === 1) {
            $date = Carbon::create(1899, 12, 30)->addDays((int) $value);   // رقم تسلسلي لتاريخ Excel

            return $date->year >= 2000 && $date->year <= 2100 ? [$date->toDateString(), null] : [null, 'invalid_date'];
        }
        if ($year === null || ! checkdate((int) $month, (int) $day, (int) $year) || (int) $year < 2000 || (int) $year > 2100) {
            return [null, 'invalid_date'];
        }

        return [sprintf('%04d-%02d-%02d', (int) $year, (int) $month, (int) $day), null];
    }

    /** @return array{0: ?int, 1: ?string} */
    private function money(string $text): array
    {
        // فاصلة عشرية بأسلوب أوروبي («85,50») كانت ستُقرأ فاصل آلاف فتتضاعف القيمة ×100: فاصلة يتبعها رقم أو رقمان في نهاية القيمة مرفوضة.
        if (preg_match('/[,،]\d{1,2}$/u', trim(Normalizer::digits($text))) === 1) {
            return [null, 'invalid_money'];
        }
        [$minor, $error] = Normalizer::money($text);
        if ($error !== null) {
            return [null, $error];
        }

        return $minor > self::MAX_MINOR ? [null, 'money_out_of_range'] : [$minor, null];
    }

    /** @return array{0: ?string, 1: ?string} */
    private function paymentType(string $text): array
    {
        $value = self::PAYMENT_ALIASES[mb_strtolower(trim($text), 'UTF-8')] ?? null;

        return $value === null ? [null, 'invalid_enum'] : [$value, null];
    }

    private function message(string $code): string
    {
        [$base, $field] = array_pad(explode(':', $code, 2), 2, null);
        $label = $field !== null && Fields::get($field) !== null ? '«'.Fields::get($field)['label_ar'].'»: ' : '';

        return $label.(self::CELL_ERRORS[$base] ?? 'قيمة غير صالحة.');
    }

    /** @param array<string, mixed> $entry */
    private function addIssue(array &$entry, string $code, string $message): void
    {
        $entry['codes'][] = $code;
        $entry['messages'][] = $message;
    }

    // ═══════════════════════════════════════════════════════════════
    //  المراجع
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  list<array<string, mixed>>  $entries  تُعدَّل بالمرجع: `refs` وأخطاء المطابقة.
     * @param  array<string, mixed>  $options
     */
    private function resolveReferences(array &$entries, array $options): void
    {
        $supplierCodes = $ids = $skus = $barcodes = [];
        foreach ($entries as $entry) {
            $v = $entry['values'];
            isset($v['supplier_code']) && $supplierCodes[(string) $v['supplier_code']] = true;
            isset($v['product_id']) && $ids[strtolower(trim((string) $v['product_id']))] = true;
            isset($v['sku']) && $skus[(string) $v['sku']] = true;
            isset($v['barcode']) && $barcodes[(string) $v['barcode']] = true;
        }

        $suppliers = [];
        foreach (array_chunk(array_keys($supplierCodes), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Partner::query()->whereIn('code', $chunk)->get() as $partner) {
                $suppliers[(string) $partner->code] = $partner;
            }
        }
        $default = null;
        if ($options['default_supplier_id'] !== null) {
            $default = Partner::query()->whereKey($options['default_supplier_id'])->first();
            if ($default === null || $this->supplierProblem($default) !== null) {
                throw new RuntimeException('المورّد الافتراضي غير موجود أو ليس مورّداً نشطاً.');
            }
        }

        $byId = $bySku = $byBarcode = [];
        $validIds = array_values(array_filter(array_keys($ids), static fn (string $id): bool => Str::isUuid($id)));
        foreach (array_chunk($validIds, self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->whereIn('id', $chunk)->get() as $product) {
                $byId[(string) $product->id] = $product;
            }
        }
        foreach (array_chunk(array_keys($skus), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->whereIn('sku', $chunk)->get() as $product) {
                $bySku[(string) $product->sku][] = $product;
            }
        }
        foreach (array_chunk(array_keys($barcodes), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->whereIn('barcode', $chunk)->get() as $product) {
                $byBarcode[(string) $product->barcode][] = $product;
            }
        }

        // سطور المتابعة في تصديرات بنود الفواتير تترك المورّد فارغاً: صفٌّ بلا كود يرث مورّد صفوف الرقم نفسه إن كان في الملف مورّدٌ واحد صريح لهذا الرقم،
        // وإلا فالافتراضي — كي لا تنشطر فاتورة واحدة إلى مورّدين صامتاً.
        $explicit = [];
        foreach ($entries as $entry) {
            $reference = DocumentDuplicateReservationService::normalizeReference($entry['values']['supplier_invoice_ref'] ?? null);
            if ($reference !== null && isset($entry['values']['supplier_code'])) {
                $explicit[$reference][(string) $entry['values']['supplier_code']] = true;
            }
        }

        foreach ($entries as &$entry) {
            $v = $entry['values'];
            if (! isset($v['supplier_code'])) {
                $reference = DocumentDuplicateReservationService::normalizeReference($v['supplier_invoice_ref'] ?? null);
                if ($reference !== null && count($explicit[$reference] ?? []) === 1) {
                    $v['supplier_code'] = (string) array_key_first($explicit[$reference]);
                }
            }

            if (isset($v['supplier_code'])) {
                $partner = $suppliers[$v['supplier_code']] ?? null;
                if ($partner === null) {
                    $this->addIssue($entry, 'supplier_not_found', "كود المورّد «{$v['supplier_code']}» غير موجود في نطاقك.");
                } elseif (($problem = $this->supplierProblem($partner)) !== null) {
                    $this->addIssue($entry, 'supplier_invalid', "المورّد «{$v['supplier_code']}»: {$problem}");
                } else {
                    $entry['refs']['partner_id'] = (string) $partner->id;
                }
            } elseif ($default !== null) {
                $entry['refs']['partner_id'] = (string) $default->id;
            } else {
                $this->addIssue($entry, 'supplier_required', '«كود المورّد» مطلوب (أو اختر مورّداً افتراضياً).');
            }

            if (DocumentDuplicateReservationService::normalizeReference($v['supplier_invoice_ref'] ?? null) === null
                && ! in_array('too_long:supplier_invoice_ref', $entry['codes'], true)) {
                $this->addIssue($entry, 'purchase_reference_required', '«رقم فاتورة المورّد» مطلوب (ولا يتكوّن من رموز فقط): هو هوية الفاتورة.');
            }

            $this->resolveProduct($entry, $byId, $bySku, $byBarcode);
        }
        unset($entry);
    }

    private function supplierProblem(Partner $partner): ?string
    {
        return match (true) {
            ! $partner->isSupplier() => 'ليس مورّداً.',
            ! $partner->is_active => 'مورّد معطّل.',
            default => null,
        };
    }

    /**
     * كل معرّف مذكور يُحلّ مستقلاً؛ المعرّفات المتعددة يجب أن تتقاطع في منتج واحد (لا يفوز أحدها صامتاً على الآخر).
     *
     * @param  array<string, mixed>  $entry
     * @param  array<string, Product>  $byId
     * @param  array<string, list<Product>>  $bySku
     * @param  array<string, list<Product>>  $byBarcode
     */
    private function resolveProduct(array &$entry, array $byId, array $bySku, array $byBarcode): void
    {
        $v = $entry['values'];
        $sets = [];
        if (isset($v['product_id'])) {
            $id = strtolower(trim((string) $v['product_id']));
            if (! Str::isUuid($id) || ! isset($byId[$id])) {
                $this->addIssue($entry, 'product_not_found', 'معرّف نبراكس للمنتج غير صالح أو غير موجود في نطاقك.');

                return;
            }
            $sets['معرّف نبراكس'] = [$id => $byId[$id]];
        }
        foreach ([['sku', $bySku, 'الرمز'], ['barcode', $byBarcode, 'الباركود']] as [$field, $index, $label]) {
            if (! isset($v[$field])) {
                continue;
            }
            $matches = $index[(string) $v[$field]] ?? [];
            if ($matches === []) {
                $this->addIssue($entry, 'product_not_found', "لا منتج بـ{$label} «{$v[$field]}».");

                return;
            }
            $sets[$label] = [];
            foreach ($matches as $product) {
                $sets[$label][(string) $product->id] = $product;
            }
        }
        if ($sets === []) {
            $this->addIssue($entry, 'product_required', 'الصف بلا معرّف منتج. أضف رمز الصنف أو الباركود أو معرّف نبراكس.');

            return;
        }
        $common = array_intersect_key(...array_values($sets));
        if ($common === []) {
            $this->addIssue($entry, 'product_identifiers_conflict', 'معرّفات الصف متعارضة: تشير إلى منتجات مختلفة ('.implode('، ', array_keys($sets)).').');

            return;
        }
        if (count($common) > 1) {
            $this->addIssue($entry, 'product_ambiguous', 'المعرّف يطابق أكثر من منتج. استخدم معرّف نبراكس.');

            return;
        }
        $product = reset($common);
        if (! $product->is_active) {
            $this->addIssue($entry, 'product_inactive', "المنتج «{$product->name}» معطّل.");
        } elseif ($product->isVariantManaged()) {
            $this->addIssue($entry, 'product_requires_variant', "المنتج «{$product->name}» متعدد الخيارات؛ الاستيراد لا يحدّد متغيّراً. أنشئ الفاتورة من الشاشة.");
        } else {
            $entry['refs']['product_id'] = (string) $product->id;
            $entry['refs']['product_name'] = (string) $product->name;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  التجميع وبناء الحمولة
    // ═══════════════════════════════════════════════════════════════

    /**
     * يجمّع الصفوف في وحدات (فواتير). صفٌّ بلا مورّد محلول أو بلا رقم صالح وحدةٌ مستقلة معطوبة (لا يُجمَّع تحت مفتاح ناقص).
     *
     * @param  list<array<string, mixed>>  $entries
     * @param  array<string, mixed>  $options
     * @param  bool  $finalize  false = الحدود فقط (عدّ الوحدات) بلا اشتقاق رأس/سطور/إجماليات
     * @return list<array<string, mixed>>
     */
    private function group(array $entries, array $options, bool $finalize = true): array
    {
        $units = [];
        $index = [];
        foreach ($entries as $position => $entry) {
            $partnerId = $entry['refs']['partner_id'] ?? null;
            $reference = DocumentDuplicateReservationService::normalizeReference($entry['values']['supplier_invoice_ref'] ?? null);
            $key = ($partnerId !== null && $reference !== null) ? $partnerId.'|'.$reference : 'row:'.$entry['row'];
            if (! isset($index[$key])) {
                $index[$key] = count($units);
                $units[] = [
                    'ordinal' => count($units), 'first_row' => $entry['row'], 'key' => $key, 'groupable' => $partnerId !== null && $reference !== null,
                    'partner_id' => $partnerId, 'reference' => $entry['values']['supplier_invoice_ref'] ?? null, 'entries' => [], 'positions' => [],
                    'messages' => [], 'warnings' => [], 'header' => [], 'items' => [], 'total_minor' => 0, 'existing_id' => null,
                ];
            }
            $units[$index[$key]]['entries'][] = $entry;
            $units[$index[$key]]['positions'][] = $position;
        }

        if ($finalize) {
            foreach ($units as &$unit) {
                $this->finalizeUnit($unit, $options);
            }
            unset($unit);
        }

        return $units;
    }

    /** @param array<string, mixed> $unit @param array<string, mixed> $options */
    private function finalizeUnit(array &$unit, array $options): void
    {
        // رأس الفاتورة: أول قيمة موجودة تفوز، وأي صفٍّ لاحق يخالفها خطأ صريح على صفّه.
        $header = [];
        foreach ($unit['entries'] as &$entry) {
            foreach (Fields::HEADER_FIELDS as $field) {
                if (! isset($entry['values'][$field])) {
                    continue;
                }
                if (! array_key_exists($field, $header)) {
                    $header[$field] = $entry['values'][$field];
                } elseif ($header[$field] !== $entry['values'][$field]) {
                    $label = Fields::get($field)['label_ar'];
                    $this->addIssue($entry, 'group_header_conflict', "«{$label}» يخالف قيمة الفاتورة نفسها في صفٍّ سابق ({$header[$field]} ≠ {$entry['values'][$field]}). صفوف الفاتورة الواحدة يجب أن تتفق على رأسها.");
                }
            }
        }
        unset($entry);

        if (! isset($header['purchase_date']) && ! array_filter($unit['entries'], fn (array $e): bool => $this->hasCellError($e, 'purchase_date'))) {
            $this->addIssue($unit['entries'][0], 'purchase_date_required', '«تاريخ الفاتورة» مطلوب (في أي صف من الفاتورة).');
        }
        if (isset($header['purchase_date'], $header['due_date']) && $header['due_date'] < $header['purchase_date']) {
            $this->addIssue($unit['entries'][0], 'due_before_invoice', 'تاريخ الاستحقاق قبل تاريخ الفاتورة.');
        }

        // السطور والإجمالي المشتق بمنطق الخدمة نفسه (`ComputesLineTax`).
        $inclusive = $options['tax_inclusive'] ?? (bool) Settings::get('purchases', 'default_tax_inclusive');
        $defaultRate = $options['default_tax_rate'] ?? (int) Settings::get('purchases', 'default_tax_rate');
        $items = [];
        $total = 0;
        foreach ($unit['entries'] as &$entry) {
            $v = $entry['values'];
            foreach (['quantity' => 'الكمية', 'unit_price' => 'سعر الوحدة'] as $key => $label) {
                if (! isset($v[$key]) && ! in_array('too_long:'.$key, $entry['codes'], true) && ! $this->hasCellError($entry, $key)) {
                    $this->addIssue($entry, $key.'_required', "«{$label}» مطلوب.");
                }
            }
            if (isset($v['quantity'], $v['unit_price'], $entry['refs']['product_id'])) {
                $gross = (int) $v['quantity'] * (int) $v['unit_price'];
                if ($gross > self::MAX_MINOR) {
                    $this->addIssue($entry, 'line_out_of_range', 'إجمالي السطر يتجاوز النطاق المالي الآمن.');
                    continue;
                }
                $rate = (int) ($v['tax_rate'] ?? $defaultRate);
                [$net, $tax] = $this->splitLineTax($gross, $rate, $inclusive);
                $total += $net + $tax;
                $items[] = [
                    'product_id' => $entry['refs']['product_id'], 'description' => $v['description'] ?? null,
                    'quantity' => (int) $v['quantity'], 'unit_price' => (int) $v['unit_price'], 'tax_rate' => $rate,
                ];
            }
        }
        unset($entry);

        if ($total > self::MAX_INVOICE_MINOR) {
            $this->addIssue($unit['entries'][0], 'invoice_out_of_range', 'إجمالي الفاتورة المشتق يتجاوز الحد الآمن للاستيراد (50 مليون ريال). قسّمها أو أنشئها من الشاشة.');
        }
        if (isset($header['invoice_total']) && (int) $header['invoice_total'] !== $total && $this->unitRowsClean($unit)) {
            $this->addIssue($unit['entries'][0], 'file_total_mismatch', 'إجمالي الفاتورة في الملف ('.number_format($header['invoice_total'] / 100, 2, '.', '').') يخالف المشتق من السطور ('.number_format($total / 100, 2, '.', '').'). الإجمالي لا يُكتب من الملف؛ صحّح الأسعار أو الكميات أو احذف العمود.');
        }

        // صفوف الفاتورة غير المتجاورة: لا خطأ (الفاتورة قد تُفرز لاحقاً) لكنها تنبيه ظاهر قبل التأكيد.
        if ($unit['groupable'] && count($unit['positions']) > 1 && max($unit['positions']) - min($unit['positions']) + 1 !== count($unit['positions'])) {
            $unit['warnings'][] = 'صفوف هذه الفاتورة غير متجاورة في الملف؛ جُمعت في فاتورة واحدة. تأكد أنها فاتورة واحدة لا نسخة مكرّرة.';
        }

        $payload = [
            'partner_id' => $unit['partner_id'], 'supplier_invoice_no' => $unit['reference'], 'purchase_date' => $header['purchase_date'] ?? null,
            'due_date' => $header['due_date'] ?? null, 'notes' => $header['notes'] ?? null, 'tax_inclusive' => $inclusive,
            'warehouse_id' => $options['warehouse_id'],
        ];
        $payment = $header['payment_type'] ?? $options['default_payment_type'];
        if ($payment !== null) {
            $payload['payment_type'] = $payment;
        }

        $unit['header_values'] = $header;
        $unit['header'] = $payload;
        $unit['items'] = $items;
        $unit['total_minor'] = $total;
        $unit['lines'] = count($unit['entries']);
    }

    /** @param array<string, mixed> $entry */
    private function hasCellError(array $entry, string $key): bool
    {
        foreach ($entry['codes'] as $code) {
            if (str_ends_with((string) $code, ':'.$key)) {
                return true;
            }
        }

        return false;
    }

    /** مقارنة إجمالي الملف بالمشتق لا معنى لها فوق صفوف معطوبة (إجمالي ناقص): لا ضجيج إضافي. */
    private function unitRowsClean(array $unit): bool
    {
        foreach ($unit['entries'] as $entry) {
            if ($entry['messages'] !== []) {
                return false;
            }
        }

        return true;
    }

    // ═══════════════════════════════════════════════════════════════
    //  المطابقة بالمشتريات القائمة
    // ═══════════════════════════════════════════════════════════════

    /**
     * يرفض وحدةً تطابق مشترى قائماً للمورّد برقمه المطبَّع (بمعيار `PurchaseService::guardDuplicate` نفسه). الفحص استشاري للمعاينة؛ الحَكَم وقت الكتابة هو الخدمة
     * وفهرس حجز الهوية، وأي تنازع متزامن يعود فشل وحدةٍ مسمّاة.
     *
     * @param  list<array<string, mixed>>  $units
     */
    private function matchExisting(array &$units): void
    {
        $suppliers = [];
        foreach ($units as $unit) {
            if ($unit['groupable']) {
                $suppliers[$unit['partner_id']] = true;
            }
        }

        $existing = [];
        foreach (array_chunk(array_keys($suppliers), self::LOOKUP_CHUNK) as $chunk) {
            Purchase::query()->whereIn('partner_id', $chunk)->whereNotNull('supplier_invoice_no')->select(['id', 'partner_id', 'supplier_invoice_no'])
                ->chunkById(2000, function ($purchases) use (&$existing): void {
                    foreach ($purchases as $purchase) {
                        $reference = DocumentDuplicateReservationService::normalizeReference($purchase->supplier_invoice_no);
                        if ($reference !== null) {
                            $existing[$purchase->partner_id.'|'.$reference] ??= (string) $purchase->id;
                        }
                    }
                });
        }

        foreach ($units as &$unit) {
            if ($unit['groupable'] && isset($existing[$unit['key']])) {
                $unit['existing_id'] = $existing[$unit['key']];
                $this->addIssue($unit['entries'][0], 'existing_purchase_matches', 'يوجد فاتورة مشتريات لهذا المورّد بالرقم نفسه. لا تُستورد فاتورة مكرّرة؛ احذف المسودة القديمة أو غيّر الرقم.');
            }
        }
        unset($unit);
    }

    /** @param array<string, mixed> $unit */
    private function planCode(array $unit): string
    {
        return $unit['action'] === 'create' ? 'c' : 'e';
    }

    /** @param list<array<string, mixed>> $units @return list<array{ordinal: int, code: string, message: string}> */
    private function unitFailures(array $units): array
    {
        $failures = [];
        foreach ($units as $unit) {
            if ($unit['valid'] === true) {
                continue;
            }
            $failures[] = ['ordinal' => (int) $unit['ordinal'], 'code' => 'unit_invalid', 'message' => $this->unitLabel($unit).implode(' · ', array_map('strval', $unit['messages']))];
        }

        return $failures;
    }

    /** بادئة تعرّف الفاتورة في رسالة الفشل (الصف/الرقم): الوحدات الفاشلة لا تُسجَّل في جدول الوحدات لمجال المستند، فرسالة التشغيلة هي ما يراه المستخدم. */
    private function unitLabel(array $unit): string
    {
        return 'الصف '.$unit['first_row'].($unit['reference'] !== null ? " (فاتورة «{$unit['reference']}»)" : '').': ';
    }

    /** @param list<array{ordinal: int, code: string, message: string}> $failures */
    private function failureSummary(string $head, array $failures): string
    {
        $shown = array_slice(array_column($failures, 'message'), 0, 3);

        return $head.' '.implode(' | ', $shown).(count($failures) > 3 ? ' … (+'.(count($failures) - 3).')' : '');
    }

    /** @param array<string, mixed> $unit @return array<string, mixed> */
    private function unitSummary(array $unit): array
    {
        return [
            'row' => $unit['first_row'], 'rows' => array_map(static fn (array $entry): int => (int) $entry['row'], $unit['entries']),
            'ordinal' => $unit['ordinal'], 'action' => $unit['action'], 'status' => $unit['status'], 'valid' => $unit['valid'],
            'supplier_invoice_ref' => $unit['reference'], 'supplier_code' => $unit['entries'][0]['values']['supplier_code'] ?? null,
            'date' => $unit['header_values']['purchase_date'] ?? null, 'lines' => $unit['lines'], 'total_minor' => $unit['total_minor'],
            'existing_purchase' => $unit['existing_id'] !== null,
            'messages' => $unit['messages'], 'warnings' => $unit['warnings'],
        ];
    }
}
