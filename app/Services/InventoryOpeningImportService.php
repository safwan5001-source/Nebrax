<?php

namespace App\Services;

use App\Models\InventoryOpening;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryOpeningService;
use App\Support\ImportHeaderMatcher;
use App\Support\InventoryOpeningFields;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use Illuminate\Http\UploadedFile;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  InventoryOpeningImportService — الملف إلى مسودة، بلا أثر قبلها
 * ═══════════════════════════════════════════════════════════════
 *  ثلاث مراحل صريحة: **فحص** الأعمدة، ثم **معاينة** لا تكتب حرفاً، ثم
 *  **إنشاء مسودة**. الترحيل خطوةٌ رابعة منفصلة تماماً في
 *  `InventoryOpeningService::post()` — فلا يفتح ملفٌ مرفوع رصيداً بالخطأ.
 *
 *  **المعاينة لا تكتب شيئاً — إطلاقاً.** لا سطر، ولا حركة، ولا قيد، ولا
 *  بيانات أساسية. المستخدم يجرّب ملفه كما يشاء ولا يترك أثراً.
 *
 *  **لا يُنشئ منتجاً ولا مخزناً.** الرصيد الافتتاحي بيانٌ عن كتالوجٍ قائم؛
 *  صنفٌ غير موجود خطأُ ملفٍ لا دعوةٌ لإنشائه بلا سعرٍ ولا تصنيف.
 *
 *  الرسائل تحمل **رمزاً ثابتاً** مع نصّها العربي: الواجهة تترجم بالرمز
 *  (عربي/إنجليزي) وتسقط على النص إن جهلت الرمز، فلا تُبنى طبقة ترجمة في
 *  الخادم ولا تبقى الإنجليزية ناقصة.
 */
class InventoryOpeningImportService
{
    public const MAX_ROWS = 2000;
    public const MAX_COLUMNS = 200;
    public const PREVIEW_ROW_LIMIT = 200;
    public const SAMPLE_ROW_LIMIT = 5;

    public function __construct(
        protected InventoryOpeningService $openings
    ) {}

    // ═══════════════════════════════════════════════════════════════
    //  ١) الفحص — أعمدة الملف وعيّناتها ومطابقتها المقترحة
    // ═══════════════════════════════════════════════════════════════

    /** @return array<string, mixed> */
    public function inspect(UploadedFile $file): array
    {
        $rows = $this->readFile($file);
        $headers = array_map(static fn ($value): string => trim((string) $value), array_shift($rows) ?? []);
        $this->assertHeaders($headers);

        $suggested = InventoryOpeningFields::autoMap($headers);
        $columns = [];

        foreach ($headers as $index => $header) {
            $samples = [];
            foreach (array_slice($rows, 0, self::SAMPLE_ROW_LIMIT) as $row) {
                $value = trim((string) ($row[$index] ?? ''));
                if ($value !== '') {
                    $samples[] = $value;
                }
            }

            $columns[] = [
                'index'            => $index,
                'header'           => $header,
                'samples'          => $samples,
                'suggested_field'  => $suggested[$index] ?? null,
            ];
        }

        return [
            'columns'    => $columns,
            'total_rows' => count(array_filter($rows, fn (array $row): bool => ! $this->isBlankRow($row))),
            'fields'     => $this->fieldContract(),
        ];
    }

    /** @return array<int, array<string, mixed>> */
    public function fieldContract(): array
    {
        $fields = [];
        foreach (InventoryOpeningFields::all() as $key => $field) {
            $fields[] = [
                'key'      => $key,
                'label_ar' => $field['label_ar'],
                'label_en' => $field['label_en'],
                'type'     => $field['type'],
                'required' => $field['required'],
            ];
        }

        return $fields;
    }

    /** قالب CSV فارغ بترويسة عربية مفهومة وصفَّي مثال. */
    public function template(): string
    {
        $keys = InventoryOpeningFields::templateHeaders();
        $labels = InventoryOpeningFields::labels('ar');

        return SpreadsheetWriter::csv(
            array_map(static fn (string $key): string => $labels[$key], $keys),
            [
                ['SKU-1001', '6280000000001', 'قهوة عربية 250غم', 'المخزن الرئيسي', '120', '18.50', ''],
                ['SKU-1002', '', 'أكياس ورقية', 'مخزن الدمام', '40', '2.75', 'دفعة قديمة'],
            ]
        );
    }

    // ═══════════════════════════════════════════════════════════════
    //  ٢) المعاينة — قراءة محضة
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function preview(UploadedFile $file, array $options): array
    {
        $parsed = $this->parse($file, $this->options($options));
        // كل الصفوف لا الصالحة وحدها: المعاينة تُرِي المستخدم ما فشل قبل ما نجح.
        $rows = array_slice($parsed['preview_rows'], 0, self::PREVIEW_ROW_LIMIT);

        return [
            'opening_date'    => $parsed['opening_date'],
            'allow_zero_cost' => $parsed['allow_zero_cost'],
            'mapping'         => $parsed['mapping'],
            'counters'        => $parsed['counters'],
            'rows'            => array_map(fn (array $row): array => $this->rowSummary($row), $rows),
            'rows_shown'      => count($rows),
            'rows_truncated'  => count($parsed['preview_rows']) > count($rows),
            'errors'          => $parsed['errors'],
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  ٣) التطبيق — مسودة فقط، لا ترحيل
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     */
    public function apply(UploadedFile $file, array $options, ?string $userId = null): InventoryOpening
    {
        $resolved = $this->options($options);
        $parsed = $this->parse($file, $resolved);

        if ($parsed['counters']['error_rows'] > 0) {
            throw new RuntimeException('لا يمكن إنشاء المستند قبل معالجة الأخطاء الظاهرة في المعاينة.');
        }
        if ($parsed['counters']['total_rows'] === 0) {
            throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
        }

        $lines = array_map(static fn (array $row): array => [
            'product_id'   => $row['product_id'],
            'warehouse_id' => $row['warehouse_id'],
            'quantity'     => $row['quantity'],
            'unit_cost'    => $row['unit_cost'],
            'notes'        => $row['notes'],
        ], $parsed['rows']);

        return $this->openings->createDraft([
            'opening_date'    => $resolved['opening_date'],
            'notes'           => $resolved['notes'],
            'source_filename' => $file->getClientOriginalName(),
            // الموافقة المعروضة في المعاينة تُحفظ مع المستند، فيرحّل الخادم بها
            // لا بعلمٍ يُرسَل مع طلب الترحيل.
            'allow_zero_cost' => $resolved['allow_zero_cost'],
            'created_by'      => $userId,
        ], $lines);
    }

    // ═══════════════════════════════════════════════════════════════
    //  الخيارات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array{opening_date: string, allow_zero_cost: bool, notes: ?string, mapping: array<int, string>|null}
     */
    protected function options(array $options): array
    {
        $date = trim((string) ($options['opening_date'] ?? ''));
        if ($date === '' || preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            throw new RuntimeException('تاريخ الرصيد الافتتاحي مطلوب بصيغة YYYY-MM-DD.');
        }

        $mapping = null;
        if (isset($options['mapping']) && is_array($options['mapping'])) {
            $mapping = [];
            foreach ($options['mapping'] as $index => $key) {
                $key = (string) $key;
                if ($key === '' || $key === 'ignore') {
                    continue;
                }
                if (InventoryOpeningFields::get($key) === null) {
                    throw new RuntimeException("الحقل «{$key}» غير معروف في عقد الأرصدة الافتتاحية.");
                }
                $mapping[(int) $index] = $key;
            }
        }

        return [
            'opening_date'    => $date,
            'allow_zero_cost' => (bool) ($options['allow_zero_cost'] ?? false),
            'notes'           => ($options['notes'] ?? null) ?: null,
            'mapping'         => $mapping,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  التحليل
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array{opening_date: string, allow_zero_cost: bool, notes: ?string, mapping: array<int, string>|null}  $options
     * @return array<string, mixed>
     */
    protected function parse(UploadedFile $file, array $options): array
    {
        $raw = $this->readFile($file);
        $headers = array_map(static fn ($value): string => trim((string) $value), array_shift($raw) ?? []);
        $this->assertHeaders($headers);

        $mapping = $options['mapping'] ?? array_filter(
            InventoryOpeningFields::autoMap($headers),
            static fn (?string $key): bool => $key !== null
        );
        $this->assertMappingCoversContract($mapping);

        $warehouses = $this->warehouseIndex();
        $rows = [];
        $errors = [];
        $seen = [];
        $counters = [
            'total_rows' => 0, 'valid_rows' => 0, 'error_rows' => 0,
            'duplicate_rows' => 0, 'products_not_found' => 0, 'warehouses_not_found' => 0,
            'products_with_movements' => 0,
            'total_quantity' => 0, 'total_value' => 0,
        ];

        foreach ($raw as $offset => $values) {
            if ($this->isBlankRow($values)) {
                continue;
            }

            // رقم الصف كما يراه المستخدم في Excel: العناوين هي الصف ١.
            $rowNumber = $offset + 2;
            $counters['total_rows']++;
            $cells = $this->cells($values, $mapping);
            $issues = [];

            if (count($values) > count($headers)) {
                $issues[] = $this->issue('row_wider_than_header', null, null,
                    'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.');
            }

            $product = $this->resolveProduct($cells, $issues);
            $warehouse = $this->resolveWarehouse($cells, $warehouses, $issues);
            $quantity = $this->parseQuantity($cells['opening_quantity'] ?? '', $issues);
            $unitCost = $this->parseMoney($cells['opening_unit_cost'] ?? '', $issues);

            if ($product !== null) {
                $this->assertProductStockable($product, $issues);
            }
            if ($unitCost === 0 && ! $options['allow_zero_cost'] && $quantity !== null) {
                $issues[] = $this->issue('zero_unit_cost', 'opening_unit_cost', $cells['opening_unit_cost'] ?? '',
                    'تكلفة الوحدة صفر: المخزون سيدخل بلا قيمة فيصير هامش الربح مضلِّلاً. '
                    . 'صحّح التكلفة، أو فعّل «السماح بتكلفة صفر» صراحةً إن كان ذلك مقصوداً.');
            }

            $this->assertUniqueWithinFile($product, $warehouse, $rowNumber, $seen, $issues, $counters);

            $valid = $issues === [];
            if ($valid) {
                $counters['valid_rows']++;
                $counters['total_quantity'] += $quantity;
                $counters['total_value'] += $quantity * $unitCost;
            } else {
                $counters['error_rows']++;
                $errors[] = ['row' => $rowNumber, 'issues' => $issues];
            }

            $rows[] = [
                'row'          => $rowNumber,
                'status'       => $valid ? 'valid' : 'error',
                'product_id'   => $product?->id,
                'product_name' => $product?->name ?? (trim((string) ($cells['product_name'] ?? '')) ?: null),
                'sku'          => $product?->sku ?? (trim((string) ($cells['sku'] ?? '')) ?: null),
                'barcode'      => $product?->barcode ?? (trim((string) ($cells['barcode'] ?? '')) ?: null),
                'warehouse_id' => $warehouse?->id,
                'warehouse'    => $warehouse?->name ?? (trim((string) ($cells['warehouse'] ?? '')) ?: null),
                'quantity'     => $quantity,
                'unit_cost'    => $unitCost,
                'total_cost'   => $quantity !== null && $unitCost !== null ? $quantity * $unitCost : null,
                'notes'        => (trim((string) ($cells['notes'] ?? '')) ?: null),
                'issues'       => $issues,
            ];
        }

        $this->flagPriorMovements($rows, $errors, $counters);

        return [
            'opening_date'    => $options['opening_date'],
            'allow_zero_cost' => $options['allow_zero_cost'],
            'mapping'         => $mapping,
            'counters'        => $counters,
            'rows'            => array_values(array_filter($rows, static fn (array $row): bool => $row['status'] === 'valid')),
            'preview_rows'    => $rows,
            'errors'          => $errors,
        ];
    }

    /**
     * الحركة السابقة تُفحص **دفعةً واحدة** بعد حلّ كل الصفوف: استعلامٌ واحد
     * بدل ألفين، والنتيجة نفسها.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @param  array<int, array<string, mixed>>  $errors
     * @param  array<string, int>  $counters
     */
    protected function flagPriorMovements(array &$rows, array &$errors, array &$counters): void
    {
        $ids = [];
        foreach ($rows as $row) {
            if ($row['status'] === 'valid' && $row['product_id'] !== null) {
                $ids[$row['product_id']] = true;
            }
        }
        if ($ids === []) {
            return;
        }

        $moved = StockMovement::whereIn('product_id', array_keys($ids))
            ->pluck('product_id')->unique()->flip();
        if ($moved->isEmpty()) {
            return;
        }

        foreach ($rows as &$row) {
            if ($row['status'] !== 'valid' || ! $moved->has($row['product_id'])) {
                continue;
            }

            $issue = $this->issue('product_has_prior_movement', 'sku', $row['sku'],
                'هذا المنتج لديه حركة مخزون سابقة فلا يقبل رصيداً افتتاحياً. '
                . 'استخدم الجرد أو الإذن المخزني لتسوية رصيده.');

            $row['issues'][] = $issue;
            $row['status'] = 'error';
            $counters['valid_rows']--;
            $counters['error_rows']++;
            $counters['products_with_movements']++;
            $counters['total_quantity'] -= (int) $row['quantity'];
            $counters['total_value'] -= (int) $row['total_cost'];
            $errors[] = ['row' => $row['row'], 'issues' => [$issue]];
        }
        unset($row);

        usort($errors, static fn (array $a, array $b): int => $a['row'] <=> $b['row']);
    }

    // ═══════════════════════════════════════════════════════════════
    //  المطابقة
    // ═══════════════════════════════════════════════════════════════

    /**
     * أولوية المطابقة: معرّف نبراكس ثم رمز الصنف ثم الباركود.
     * **الاسم ليس مفتاح هوية ولن يكون** — يُعرض للمراجعة فقط.
     *
     * @param  array<string, string>  $cells
     * @param  array<int, array<string, mixed>>  $issues
     */
    protected function resolveProduct(array $cells, array &$issues): ?Product
    {
        $id = trim((string) ($cells['nebrax_id'] ?? ''));
        if ($id !== '') {
            if (preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', $id) !== 1) {
                $issues[] = $this->issue('invalid_nebrax_id', 'nebrax_id', $id,
                    'معرّف نبراكس غير صالح. احذف العمود لتتم المطابقة برمز الصنف.');

                return null;
            }
            // يمرّ عبر `Product::query()` فيخضع لنطاق المستأجر: معرّفٌ من مؤسسة
            // أخرى لا يُحلّ ولا يكشف وجوده — يصير «غير موجود» كأي قيمة خاطئة.
            $product = Product::query()->whereKey($id)->first();
            if ($product === null) {
                $issues[] = $this->issue('product_not_found', 'nebrax_id', $id,
                    'لا يوجد صنف بهذا المعرّف في كتالوج مؤسستك. تأكد أن الملف مُصدَّر من المؤسسة نفسها.');
            }

            return $product;
        }

        $sku = trim((string) ($cells['sku'] ?? ''));
        if ($sku !== '') {
            $product = Product::query()->where('sku', $sku)->first();
            if ($product === null) {
                $issues[] = $this->issue('product_not_found', 'sku', $sku,
                    'لا يوجد صنف بهذا الرمز في كتالوج مؤسستك. أنشئ الصنف أولاً من شاشة المنتجات.');
            }

            return $product;
        }

        $barcode = trim((string) ($cells['barcode'] ?? ''));
        if ($barcode !== '') {
            $matches = Product::query()->where('barcode', $barcode)->limit(2)->get();
            if ($matches->count() > 1) {
                $issues[] = $this->issue('ambiguous_barcode', 'barcode', $barcode,
                    'هذا الباركود يطابق أكثر من صنف. استخدم رمز الصنف بدل الباركود.');

                return null;
            }
            if ($matches->isEmpty()) {
                $issues[] = $this->issue('product_not_found', 'barcode', $barcode,
                    'لا يوجد صنف بهذا الباركود في كتالوج مؤسستك. أنشئ الصنف أولاً من شاشة المنتجات.');

                return null;
            }

            return $matches->first();
        }

        $issues[] = $this->issue('missing_product_identifier', 'sku', null,
            'الصف بلا معرّف صنف. أضف رمز الصنف أو الباركود أو معرّف نبراكس.');

        return null;
    }

    /**
     * أولوية المخزن: المعرّف التقني ثم الكود ثم الاسم. الاسم يُقبل فقط إن كان
     * غير ملتبس — مخزنان بالاسم نفسه يوقفان الصفّ ولا يُخمَّن أحدهما.
     *
     * @param  array<string, string>  $cells
     * @param  array{by_id: array<string, Warehouse>, by_code: array<string, Warehouse|false>, by_name: array<string, Warehouse|false>}  $index
     * @param  array<int, array<string, mixed>>  $issues
     */
    protected function resolveWarehouse(array $cells, array $index, array &$issues): ?Warehouse
    {
        $id = trim((string) ($cells['warehouse_id'] ?? ''));
        if ($id !== '') {
            $warehouse = $index['by_id'][$id] ?? null;
            if ($warehouse === null) {
                $issues[] = $this->issue('warehouse_not_found', 'warehouse_id', $id,
                    'لا يوجد مخزن بهذا المعرّف في مؤسستك.');
            }

            return $this->assertWarehouseActive($warehouse, $issues);
        }

        $value = trim((string) ($cells['warehouse'] ?? ''));
        if ($value === '') {
            $issues[] = $this->issue('missing_warehouse', 'warehouse', null,
                'الصف بلا مخزن. أضف عمود المخزن بكود المخزن أو اسمه.');

            return null;
        }

        $needle = ImportHeaderMatcher::normalize($value);

        $byCode = $index['by_code'][$needle] ?? null;
        if ($byCode instanceof Warehouse) {
            return $this->assertWarehouseActive($byCode, $issues);
        }

        $byName = $index['by_name'][$needle] ?? null;
        if ($byName === false) {
            $issues[] = $this->issue('ambiguous_warehouse', 'warehouse', $value,
                'أكثر من مخزن بهذا الاسم. استخدم كود المخزن بدل الاسم.');

            return null;
        }
        if ($byName instanceof Warehouse) {
            return $this->assertWarehouseActive($byName, $issues);
        }

        $issues[] = $this->issue('warehouse_not_found', 'warehouse', $value,
            'لا يوجد مخزن بهذا الاسم أو الكود في مؤسستك. أنشئه أولاً من شاشة المخازن.');

        return null;
    }

    /** @param array<int, array<string, mixed>> $issues */
    protected function assertWarehouseActive(?Warehouse $warehouse, array &$issues): ?Warehouse
    {
        if ($warehouse === null) {
            return null;
        }
        if (! $warehouse->is_active) {
            $issues[] = $this->issue('warehouse_inactive', 'warehouse', $warehouse->name,
                'هذا المخزن غير نشط. فعّله أولاً أو اختر مخزناً آخر.');

            return null;
        }

        return $warehouse;
    }

    /**
     * فهرس المخازن — عددها صغير فيُبنى مرّةً واحدة. الاسم المكرّر يُوسم `false`
     * كي يُرفض التطابق الغامض بدل أن يفوز أوّلُه صامتاً.
     *
     * @return array{by_id: array<string, Warehouse>, by_code: array<string, Warehouse|false>, by_name: array<string, Warehouse|false>}
     */
    protected function warehouseIndex(): array
    {
        $byId = [];
        $byCode = [];
        $byName = [];

        foreach (Warehouse::query()->get() as $warehouse) {
            $byId[$warehouse->id] = $warehouse;

            $code = ImportHeaderMatcher::normalize((string) $warehouse->code);
            if ($code !== '') {
                $byCode[$code] = isset($byCode[$code]) ? false : $warehouse;
            }

            $name = ImportHeaderMatcher::normalize((string) $warehouse->name);
            if ($name !== '') {
                $byName[$name] = isset($byName[$name]) ? false : $warehouse;
            }
        }

        return ['by_id' => $byId, 'by_code' => $byCode, 'by_name' => $byName];
    }

    /** @param array<int, array<string, mixed>> $issues */
    protected function assertProductStockable(Product $product, array &$issues): void
    {
        if ($product->type === 'service') {
            $issues[] = $this->issue('service_item', 'sku', $product->sku,
                'الخدمات لا رصيد مخزني لها. احذف هذا الصف من الملف.');

            return;
        }
        if (! $product->track_inventory) {
            $issues[] = $this->issue('product_not_tracked', 'sku', $product->sku,
                'هذا الصنف لا يتتبّع مخزوناً. فعّل «تتبّع المخزون» في بطاقته أولاً.');
        }
    }

    /**
     * تكرار المنتج نفسه في المخزن نفسه خطأٌ في **الصفّين** معاً: أيّهما الصحيح
     * قرارُ صاحب الملف لا تخمينُ النظام.
     *
     * @param  array<string, int>  $seen
     * @param  array<int, array<string, mixed>>  $issues
     * @param  array<string, int>  $counters
     */
    protected function assertUniqueWithinFile(?Product $product, ?Warehouse $warehouse, int $rowNumber, array &$seen, array &$issues, array &$counters): void
    {
        if ($product === null || $warehouse === null) {
            return;
        }

        $key = $product->id . '|' . $warehouse->id;
        if (isset($seen[$key])) {
            $issues[] = $this->issue('duplicate_row', 'sku', $product->sku,
                "هذا الصنف مكرّر في المخزن نفسه (الصف {$seen[$key]}). ادمج الكميتين في صفّ واحد.");
            $counters['duplicate_rows']++;

            return;
        }

        $seen[$key] = $rowNumber;
    }

    // ═══════════════════════════════════════════════════════════════
    //  محوّلات القيم
    // ═══════════════════════════════════════════════════════════════

    /** @param array<int, array<string, mixed>> $issues */
    protected function parseQuantity(string $value, array &$issues): ?int
    {
        $normalized = preg_replace('/[,\s\x{00A0}]/u', '', $this->latinDigits(trim($value))) ?? '';

        if ($normalized === '') {
            $issues[] = $this->issue('missing_quantity', 'opening_quantity', $value,
                'الكمية الافتتاحية مطلوبة لكل صف.');

            return null;
        }
        if (preg_match('/^\d+$/', $normalized) !== 1) {
            $issues[] = $this->issue('invalid_quantity', 'opening_quantity', $value,
                'الكمية يجب أن تكون عدداً صحيحاً موجباً بلا كسور.');

            return null;
        }
        $quantity = (int) $normalized;
        if ($quantity <= 0) {
            $issues[] = $this->issue('non_positive_quantity', 'opening_quantity', $value,
                'الكمية الافتتاحية يجب أن تكون أكبر من صفر. الصف بلا كمية يُحذف من الملف.');

            return null;
        }
        if ($quantity > 1_000_000_000) {
            $issues[] = $this->issue('quantity_out_of_range', 'opening_quantity', $value,
                'الكمية تتجاوز المدى الآمن. تحقّق من الوحدة المستعملة في الملف.');

            return null;
        }

        return $quantity;
    }

    /**
     * الريال البشري (`12.50`) إلى هللات (`1250`) — بلا `float` في أي خطوة،
     * فلا ينحرف `0.1 + 0.2` في كتالوجٍ كامل.
     *
     * @param  array<int, array<string, mixed>>  $issues
     */
    protected function parseMoney(string $value, array &$issues): ?int
    {
        $normalized = $this->latinDigits(trim($value));
        $normalized = str_replace(['٫', '،'], ['.', ''], $normalized);
        $normalized = preg_replace('/[,\s\x{00A0}]/u', '', $normalized) ?? $normalized;

        if ($normalized === '') {
            $issues[] = $this->issue('missing_unit_cost', 'opening_unit_cost', $value,
                'تكلفة الوحدة مطلوبة لكل صف: بها يُقيَّم المخزون ويُبنى القيد.');

            return null;
        }
        if (preg_match('/^\d+(?:\.\d{1,2})?$/', $normalized) !== 1) {
            $issues[] = $this->issue('invalid_unit_cost', 'opening_unit_cost', $value,
                'تكلفة الوحدة يجب أن تكون رقماً غير سالب بصيغة 123.45 وبمنزلتين عشريتين على الأكثر.');

            return null;
        }
        if (strlen(explode('.', $normalized)[0]) > 13) {
            $issues[] = $this->issue('unit_cost_out_of_range', 'opening_unit_cost', $value,
                'تكلفة الوحدة تتجاوز النطاق المالي الآمن.');

            return null;
        }

        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');

        return ((int) $whole * 100) + (int) str_pad($fraction, 2, '0');
    }

    protected function latinDigits(string $value): string
    {
        return strtr($value, [
            '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
            '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
            '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        ]);
    }

    // ═══════════════════════════════════════════════════════════════
    //  أدوات
    // ═══════════════════════════════════════════════════════════════

    /**
     * رمزٌ ثابت + حقل + قيمة + نصّ عربي يقول ما العمل. الواجهة تترجم بالرمز،
     * فلا يُعرض للمستخدم استثناءٌ داخلي خام أبداً.
     *
     * @return array{code: string, field: ?string, value: ?string, message: string}
     */
    protected function issue(string $code, ?string $field, ?string $value, string $message): array
    {
        return [
            'code'    => $code,
            'field'   => $field,
            'value'   => $value === null ? null : mb_substr((string) $value, 0, 120),
            'message' => $message,
        ];
    }

    /** @param array<int, string> $mapping @return array<string, string> */
    protected function cells(array $values, array $mapping): array
    {
        $cells = [];
        foreach ($mapping as $index => $key) {
            $cells[$key] = trim((string) ($values[$index] ?? ''));
        }

        return $cells;
    }

    /** @param array<int, string> $mapping */
    protected function assertMappingCoversContract(array $mapping): void
    {
        $mapped = array_values($mapping);

        if (count($mapped) !== count(array_unique($mapped))) {
            throw new RuntimeException('لا يمكن ربط عمودين بالحقل نفسه. صحّح مطابقة الأعمدة.');
        }
        if (array_intersect(InventoryOpeningFields::PRODUCT_IDENTIFIERS, $mapped) === []) {
            throw new RuntimeException('الملف يحتاج عمود تعريف للصنف: رمز الصنف أو الباركود أو معرّف نبراكس.');
        }
        if (array_intersect(InventoryOpeningFields::WAREHOUSE_IDENTIFIERS, $mapped) === []) {
            throw new RuntimeException('الملف يحتاج عمود المخزن: كود المخزن أو اسمه أو معرّفه.');
        }
        foreach (InventoryOpeningFields::all() as $key => $field) {
            if ($field['required'] && ! in_array($key, $mapped, true)) {
                throw new RuntimeException("الحقل «{$field['label_ar']}» مطلوب ولم يُربط بأي عمود.");
            }
        }
    }

    /** @param array<int, string> $headers */
    protected function assertHeaders(array $headers): void
    {
        if ($headers === [] || implode('', $headers) === '') {
            throw new RuntimeException('صف العناوين في الملف فارغ. ضع أسماء الأعمدة في الصف الأول.');
        }

        $normalized = array_filter(array_map(
            static fn (string $header): string => ImportHeaderMatcher::normalize($header),
            $headers
        ), static fn (string $header): bool => $header !== '');

        if (count($normalized) !== count(array_unique($normalized))) {
            throw new RuntimeException('صف العناوين يحتوي أسماء أعمدة مكرّرة. وحّدها قبل الرفع.');
        }
    }

    /** @return array<int, array<int, string>> */
    protected function readFile(UploadedFile $file): array
    {
        $extension = strtolower((string) ($file->getClientOriginalExtension() ?: $file->extension()));
        if (! SpreadsheetReader::isSupportedExtension($extension)) {
            throw new RuntimeException('صيغة الملف غير مدعومة. ارفع ملف CSV أو XLSX.');
        }

        return SpreadsheetReader::read($file->getRealPath(), $extension, self::MAX_ROWS, self::MAX_COLUMNS);
    }

    /** @param array<int, string> $values */
    protected function isBlankRow(array $values): bool
    {
        foreach ($values as $value) {
            if (trim((string) $value) !== '') {
                return false;
            }
        }

        return true;
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    protected function rowSummary(array $row): array
    {
        return [
            'row'          => $row['row'],
            'status'       => $row['status'],
            'sku'          => $row['sku'],
            'barcode'      => $row['barcode'],
            'product_name' => $row['product_name'],
            'warehouse'    => $row['warehouse'],
            'quantity'     => $row['quantity'],
            'unit_cost'    => $row['unit_cost'],
            'total_cost'   => $row['total_cost'],
            'notes'        => $row['notes'],
            'issues'       => $row['issues'],
        ];
    }
}
