<?php

namespace App\Services;

use App\Models\Product;
use App\Models\StockPermit;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\StockPermitService;
use App\Services\Accounting\UnitConversion;
use App\Support\ImportUnitFailureException;
use App\Support\ProductImportValueNormalizer as Normalizer;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Support\StockPermitImportFields as Fields;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * استيراد بنود إذنٍ مخزني — IMP-H7-S3. **الملف كله إذنٌ واحد بحالة `draft`** يُنشأ بـ`StockPermitService::create` (مسار الإنشاء المباشر نفسه)؛ رأسه (النوع · المخزن ·
 * مخزن الوجهة · التاريخ · السبب · الملاحظات) خيارات التشغيلة المجمَّدة مع المعاينة، وصفوفه السطور. **لا ترحيل ولا قيد ولا حركة مخزون**: الترحيل فعلٌ منفصل
 * (`StockPermitService::post`) يحرّك المخزون ويولّد القيد كما لو أُنشئ الإذن يدوياً.
 *
 *  - **وحدة التنفيذ الملف كله** (ذرّي): معاملة واحدة؛ أي خطأ صف يمنع الكل — لا إذنٌ ناقص السطور بسبب ملف.
 *  - **النوع إلزامي ولا افتراضي له**: الإضافة ترفع المخزون والصرف يخفضه، فلا يُخمَّن نوعٌ من الملف.
 *  - **تكلفة الإضافة** عمودٌ بالريال (→ هللات)، **ومطلوبة** ما لم تُفعَّل `allow_zero_cost` للتشغيلة صراحةً (CLAUDE.md قاعدة 6): إضافةٌ بتكلفة صفر تُخفّض متوسط التكلفة
 *    صامتةً. الصرف والتحويل يأخذان متوسط التكلفة عند الترحيل، فعمود التكلفة معهما خطأ إعداد لا قيمةٌ تُتجاهَل بصمت.
 *  - **الوصول:** كما يفعل المتحكّم — المخزن (والوجهة) ضمن نطاق المستخدم، وإلا رُفض. يُفحَص عند المعاينة وفي كل تنفيذ.
 *  - **لا مصدر لمنع التكرار**: الإذن بلا مرجع خارجي، فتكرار رفع الملف نفسه ينشئ مسودة ثانية (تُحذف أو لا تُرحَّل)؛ لا يُخترَع مفتاحٌ للتكرار هنا.
 *  - الرسائل بنص عربي وأرقام صفوف كما في Excel (العناوين صف ١).
 */
class StockPermitImportService
{
    public const MAX_ROWS = 2000;
    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;
    private const PREVIEW_ROW_LIMIT = 200;
    private const LOOKUP_CHUNK = 400;

    public function __construct(
        private readonly StockPermitService $permits,
        private readonly UnitConversion $units,
    ) {}

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
        return SpreadsheetWriter::csv(Fields::templateHeaders(), [
            ['', 'SKU-1001', '', '12', 'قطعة', '25.00'],
            ['', 'SKU-1002', '', '3', 'كرتون', '280.00'],
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
    public function preview(UploadedFile $file, array $options, ?string $userId, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);
        $this->assertWarehouses($resolved, $userId);
        $parsed = $this->parse($file, $resolved, $maxRows);
        $rows = array_slice($parsed['rows'], 0, self::PREVIEW_ROW_LIMIT);

        return [
            'permit_type' => $resolved['permit_type'], 'permit_date' => $resolved['permit_date'],
            'warehouse_id' => $resolved['warehouse_id'], 'warehouse_name' => $parsed['warehouse_name'],
            'target_warehouse_id' => $resolved['target_warehouse_id'], 'target_warehouse_name' => $parsed['target_warehouse_name'],
            'allow_zero_cost' => $resolved['allow_zero_cost'], 'mapping' => $parsed['mapping'],
            'total_rows' => $parsed['total_rows'], 'line_rows' => $parsed['counters']['line'], 'warning_rows' => $parsed['counters']['warning'],
            'error_rows' => $parsed['counters']['error'], 'valid_rows' => $parsed['total_rows'] - $parsed['counters']['error'], 'invalid_rows' => $parsed['counters']['error'],
            'total_cost' => $parsed['total_cost'],
            'rows' => array_map(fn (array $row): array => $this->rowSummary($row), $rows),
            'rows_shown' => count($rows), 'rows_truncated' => count($parsed['rows']) > count($rows),
            'errors' => $parsed['errors'],
        ];
    }

    /**
     * ينشئ الإذن المسودة بكل سطوره في معاملة واحدة، أو لا شيء.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);

        return DB::transaction(function () use ($file, $resolved, $userId, $maxRows): array {
            $this->assertWarehouses($resolved, $userId);
            $parsed = $this->parse($file, $resolved, $maxRows);

            if ($parsed['total_rows'] === 0) {
                throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
            }
            if ($parsed['counters']['error'] > 0) {
                throw new ImportUnitFailureException('لا يمكن تطبيق الاستيراد قبل معالجة الأخطاء الظاهرة في المعاينة.', $this->rowFailures($parsed['rows']));
            }

            $items = array_map(static fn (array $row): array => [
                'product_id' => $row['product_id'], 'quantity' => $row['quantity'], 'unit' => $row['requested_unit'], 'unit_cost' => $row['unit_cost'] ?? 0,
            ], $parsed['rows']);

            $permit = $this->permits->create([
                'type' => $resolved['permit_type'], 'warehouse_id' => $resolved['warehouse_id'], 'target_warehouse_id' => $resolved['target_warehouse_id'],
                'permit_date' => $resolved['permit_date'], 'reason' => $resolved['reason'], 'notes' => $resolved['notes'], 'created_by' => $userId,
            ], $items);

            return [
                'permit_id' => $permit->id, 'permit_number' => $permit->number, 'permit_type' => $permit->type,
                'created' => 1, 'updated' => 0, 'skipped' => 0, 'lines' => $permit->lines->count(), 'total_rows' => $parsed['total_rows'],
                'results' => array_map(fn (array $row): array => $this->rowSummary($row), $parsed['rows']),
            ];
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  الخيارات والوصول
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array{permit_type: string, warehouse_id: string, target_warehouse_id: ?string, permit_date: string, reason: ?string, notes: ?string, allow_zero_cost: bool, mapping: array<int, string|null>|null}
     */
    public function options(array $options): array
    {
        $type = (string) ($options['permit_type'] ?? '');
        if (! in_array($type, StockPermit::TYPES, true)) {
            throw new RuntimeException('نوع الإذن مطلوب: إضافة أو صرف أو تحويل.');
        }
        $warehouse = $this->uuid($options['warehouse_id'] ?? null, 'المخزن مطلوب.');
        $target = ($options['target_warehouse_id'] ?? null) === null || $options['target_warehouse_id'] === '' ? null : $this->uuid($options['target_warehouse_id'], 'معرّف مخزن الوجهة غير صالح.');
        if ($type === 'transfer') {
            if ($target === null) {
                throw new RuntimeException('إذن التحويل يلزمه مخزن وجهة.');
            }
            if ($target === $warehouse) {
                throw new RuntimeException('لا يُحوَّل المخزن إلى نفسه.');
            }
        } elseif ($target !== null) {
            throw new RuntimeException('مخزن الوجهة يخص إذن التحويل وحده.');
        }

        $date = (string) ($options['permit_date'] ?? '');
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1 || ! checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4))) {
            throw new RuntimeException('تاريخ الإذن مطلوب بصيغة YYYY-MM-DD.');
        }
        $reason = $this->text($options['reason'] ?? null, 255, 'السبب');
        $notes = $this->text($options['notes'] ?? null, 500, 'الملاحظات');

        $mapping = null;
        if (isset($options['mapping']) && is_array($options['mapping'])) {
            $mapping = [];
            foreach ($options['mapping'] as $index => $key) {
                if (! is_numeric($index)) {
                    continue;
                }
                $key = $key === null || $key === '' || $key === 'ignore' ? null : (string) $key;
                if ($key !== null && Fields::get($key) === null) {
                    throw new RuntimeException('أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد بنود الإذن.');
                }
                $mapping[(int) $index] = $key;
            }
        }

        return [
            'permit_type' => $type, 'warehouse_id' => $warehouse, 'target_warehouse_id' => $target, 'permit_date' => $date,
            'reason' => $reason, 'notes' => $notes, 'allow_zero_cost' => filter_var($options['allow_zero_cost'] ?? false, FILTER_VALIDATE_BOOLEAN), 'mapping' => $mapping,
        ];
    }

    private function uuid(mixed $value, string $message): string
    {
        $id = strtolower(trim((string) $value));
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id) !== 1) {
            throw new RuntimeException($message);
        }

        return $id;
    }

    private function text(mixed $value, int $max, string $label): ?string
    {
        if ($value === null) {
            return null;
        }
        $text = trim((string) $value);
        if (mb_strlen($text) > $max) {
            throw new RuntimeException("{$label} تتجاوز {$max} حرفاً.");
        }

        return $text === '' ? null : $text;
    }

    /**
     * المخزن (والوجهة) موجودان في المؤسسة ونشطان، وضمن وصول المستخدم كما يفعل المتحكّم (مخزنه وفرعه)؛ وإلا رُفض بلا كشف لوجود مخزن لا يراه.
     * فاعل مجهول (حُذف) يُرفض مغلقاً؛ `null` = مشغّل نظام موثوق.
     *
     * @param  array{warehouse_id: string, target_warehouse_id: ?string}  $options
     */
    public function assertWarehouses(array $options, ?string $userId): void
    {
        $user = $userId !== null ? User::query()->find($userId) : null;
        if ($userId !== null && $user === null) {
            throw new RuntimeException('هذا المخزن خارج نطاق صلاحياتك.');
        }
        foreach (array_filter([$options['warehouse_id'], $options['target_warehouse_id']]) as $id) {
            $warehouse = Warehouse::query()->whereKey($id)->first();
            if ($warehouse === null || ($user !== null && (! $user->canAccessWarehouse($warehouse->id)
                || ($warehouse->branch_id !== null && ! $user->canAccessBranch($warehouse->branch_id))))) {
                throw new RuntimeException('هذا المخزن خارج نطاق صلاحياتك.');
            }
            if (! $warehouse->is_active) {
                throw new RuntimeException("المخزن «{$warehouse->name}» معطّل.");
            }
        }
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
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private function parse(UploadedFile $file, array $options, int $maxRows): array
    {
        $raw = $this->readFile($file, $maxRows);
        if ($raw === []) {
            throw new RuntimeException('الملف فارغ.');
        }
        $headers = array_map('strval', $raw[0]);
        $mapping = $options['mapping'] ?? Fields::autoMap($headers);
        $this->assertMapping($mapping, $options);

        $entries = [];
        foreach (array_slice($raw, 1, null, true) as $sheetIndex => $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $entry = [
                'row' => $sheetIndex + 1, 'ordinal' => count($entries), 'messages' => [], 'warnings' => [], 'cells' => [],
                'product_id' => null, 'sku' => null, 'barcode' => null, 'name' => null, 'quantity' => null,
                'requested_unit' => null, 'unit' => null, 'unit_cost' => null, 'line_cost' => null, 'action' => 'error',
            ];
            if (count($values) > count($headers)) {
                $entry['messages'][] = 'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.';
            }
            foreach ($mapping as $index => $key) {
                if ($key !== null) {
                    $entry['cells'][$key] = $this->unquote((string) ($values[$index] ?? ''));
                }
            }
            $entries[] = $entry;
        }

        [$byId, $bySku, $byBarcode] = $this->loadProducts($entries);
        $seen = [];
        foreach ($entries as &$entry) {
            $this->resolveProduct($entry, $byId, $bySku, $byBarcode);
            $this->readQuantity($entry);
            $this->readUnit($entry);
            $this->readCost($entry, $options);
            if ($entry['product_id'] !== null) {
                $seen[$entry['product_id'].'|'.($entry['unit'] ?? '')][] = $entry['ordinal'];
            }
        }
        unset($entry);

        // المنتج والوحدة نفسهما في صفّين يُجمَعان في الإذن (سطران)؛ التنبيه لأن التكرار غالباً لصقٌ مزدوج يضاعف الكمية صامتاً — القرار لصاحب الملف.
        foreach ($seen as $ordinals) {
            if (count($ordinals) > 1) {
                foreach ($ordinals as $ordinal) {
                    $others = implode('، ', array_map(fn (int $o): string => (string) $entries[$o]['row'], array_values(array_diff($ordinals, [$ordinal]))));
                    $entries[$ordinal]['warnings'][] = "الصنف والوحدة مكرّران في الملف (الصفوف: {$others}) وسيصيران سطرين في الإذن.";
                }
            }
        }

        $counters = ['line' => 0, 'warning' => 0, 'error' => 0];
        $errors = [];
        $totalCost = 0;
        foreach ($entries as &$entry) {
            if ($entry['messages'] !== []) {
                $entry['action'] = 'error';
                $counters['error']++;
                $errors[] = ['row' => $entry['row'], 'messages' => array_values(array_unique($entry['messages']))];
            } else {
                $entry['action'] = 'line';
                $counters['line']++;
                $totalCost += (int) ($entry['line_cost'] ?? 0);
                if ($entry['warnings'] !== []) {
                    $counters['warning']++;
                }
            }
            $entry['valid'] = $entry['messages'] === [];
            $entry['status'] = ! $entry['valid'] ? 'error' : ($entry['warnings'] !== [] ? 'warning' : 'ok');
        }
        unset($entry);

        return [
            'rows' => $entries, 'total_rows' => count($entries), 'mapping' => $mapping, 'counters' => $counters, 'errors' => $errors, 'total_cost' => $totalCost,
            'warehouse_name' => Warehouse::query()->whereKey($options['warehouse_id'])->value('name'),
            'target_warehouse_name' => $options['target_warehouse_id'] !== null ? Warehouse::query()->whereKey($options['target_warehouse_id'])->value('name') : null,
        ];
    }

    /** @param array<int, string|null> $mapping @param array<string, mixed> $options */
    private function assertMapping(array $mapping, array $options): void
    {
        $chosen = array_values(array_filter($mapping, static fn ($key): bool => $key !== null));
        if (count($chosen) !== count(array_unique($chosen))) {
            throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
        }
        if (array_intersect(['product_id', 'sku', 'barcode'], $chosen) === []) {
            throw new RuntimeException('الملف يحتاج عمود تعريف للصنف: رمز الصنف أو الباركود أو معرّف نبراكس. الاسم لا يصلح معرّفاً.');
        }
        if (! in_array('quantity', $chosen, true)) {
            throw new RuntimeException('الاستيراد يحتاج عمود «'.Fields::get('quantity')['label_ar'].'».');
        }
        $hasCost = in_array('unit_cost', $chosen, true);
        if ($options['permit_type'] !== 'receipt' && $hasCost) {
            throw new RuntimeException('عمود «تكلفة الوحدة» يخص إذن الإضافة وحده؛ الصرف والتحويل يأخذان متوسط التكلفة عند الترحيل. تجاهل العمود.');
        }
        if ($options['permit_type'] === 'receipt' && ! $hasCost && ! $options['allow_zero_cost']) {
            throw new RuntimeException('إذن الإضافة يحتاج عمود «تكلفة الوحدة»، أو فعّل «السماح بتكلفة صفر» صراحةً لهذه التشغيلة.');
        }
    }

    /**
     * @param  list<array<string, mixed>>  $entries
     * @return array{0: array<string, Product>, 1: array<string, list<Product>>, 2: array<string, list<Product>>}
     */
    private function loadProducts(array $entries): array
    {
        $ids = $skus = $barcodes = [];
        foreach ($entries as $entry) {
            $c = $entry['cells'];
            ($c['product_id'] ?? '') !== '' && $ids[strtolower($c['product_id'])] = true;
            ($c['sku'] ?? '') !== '' && $skus[$c['sku']] = true;
            ($c['barcode'] ?? '') !== '' && $barcodes[$c['barcode']] = true;
        }

        $byId = $bySku = $byBarcode = [];
        $validIds = array_values(array_filter(array_keys($ids), static fn (string $id): bool => Str::isUuid($id)));
        foreach (array_chunk($validIds, self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->with('unitTemplate')->whereIn('id', $chunk)->get() as $product) {
                $byId[(string) $product->id] = $product;
            }
        }
        foreach (array_chunk(array_keys($skus), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->with('unitTemplate')->whereIn('sku', $chunk)->get() as $product) {
                $bySku[(string) $product->sku][] = $product;
            }
        }
        foreach (array_chunk(array_keys($barcodes), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->with('unitTemplate')->whereIn('barcode', $chunk)->get() as $product) {
                $byBarcode[(string) $product->barcode][] = $product;
            }
        }

        return [$byId, $bySku, $byBarcode];
    }

    /**
     * كل معرّف مذكور يُحلّ مستقلاً إلى مجموعة منتجات؛ المعرّفات المتعددة يجب أن تتقاطع في منتج واحد (لا يفوز أحدها صامتاً على الآخر).
     *
     * @param  array<string, mixed>  $entry
     * @param  array<string, Product>  $byId
     * @param  array<string, list<Product>>  $bySku
     * @param  array<string, list<Product>>  $byBarcode
     */
    private function resolveProduct(array &$entry, array $byId, array $bySku, array $byBarcode): void
    {
        $c = $entry['cells'];
        $entry['sku'] = ($c['sku'] ?? '') !== '' ? $c['sku'] : null;
        $entry['barcode'] = ($c['barcode'] ?? '') !== '' ? $c['barcode'] : null;

        $sets = [];
        if (($c['product_id'] ?? '') !== '') {
            $id = strtolower($c['product_id']);
            if (! Str::isUuid($id) || ! isset($byId[$id])) {
                $entry['messages'][] = 'معرّف نبراكس للمنتج غير صالح أو غير موجود في نطاقك.';

                return;
            }
            $sets['معرّف نبراكس'] = [$id => $byId[$id]];
        }
        foreach ([['sku', $bySku, 'الرمز'], ['barcode', $byBarcode, 'الباركود']] as [$field, $index, $label]) {
            if (($c[$field] ?? '') === '') {
                continue;
            }
            $matches = $index[$c[$field]] ?? [];
            if ($matches === []) {
                $entry['messages'][] = "لا منتج بـ{$label} «{$c[$field]}».";

                return;
            }
            $sets[$label] = [];
            foreach ($matches as $product) {
                $sets[$label][(string) $product->id] = $product;
            }
        }
        if ($sets === []) {
            $entry['messages'][] = 'الصف بلا معرّف منتج. أضف رمز الصنف أو الباركود أو معرّف نبراكس.';

            return;
        }
        $common = array_intersect_key(...array_values($sets));
        if ($common === []) {
            $entry['messages'][] = 'معرّفات الصف متعارضة: تشير إلى منتجات مختلفة ('.implode('، ', array_keys($sets)).'). صحّح الصف أو احذف الأعمدة الزائدة.';

            return;
        }
        if (count($common) > 1) {
            $entry['messages'][] = 'المعرّف يطابق أكثر من منتج. استخدم معرّف نبراكس.';

            return;
        }
        /** @var Product $product */
        $product = reset($common);
        $entry['name'] = $product->name;
        if (! $product->is_active) {
            $entry['messages'][] = "المنتج «{$product->name}» معطّل.";
        } elseif (! $product->track_inventory) {
            $entry['messages'][] = "المنتج «{$product->name}» غير متابَع مخزنياً؛ لا يدخل إذناً مخزنياً.";
        } elseif ($product->isVariantManaged()) {
            $entry['messages'][] = "المنتج «{$product->name}» متعدد الخيارات؛ الاستيراد لا يحدّد متغيّراً. أنشئ الإذن من الشاشة.";
        } else {
            $entry['product_id'] = (string) $product->id;
            $entry['product'] = $product;
        }
    }

    /** @param array<string, mixed> $entry */
    private function readQuantity(array &$entry): void
    {
        $text = (string) ($entry['cells']['quantity'] ?? '');
        if (trim($text) === '') {
            $entry['messages'][] = 'الكمية فارغة.';

            return;
        }
        // Normalizer::integer يقبل صيغة النسبة (25% ← 25)؛ الكمية ليست نسبة، فتُرفض قبل التطبيع لا تُحوَّل صامتةً.
        [$value, $error] = preg_match('/[%٪]/u', $text) === 1
            ? [null, 'percent']
            : Normalizer::integer($text, 1, Fields::MAX_QUANTITY);
        if ($error !== null) {
            $entry['messages'][] = 'الكمية يجب أن تكون عدداً صحيحاً بين 1 و'.number_format(Fields::MAX_QUANTITY).' بلا كسور.';

            return;
        }
        $entry['quantity'] = $value;
    }

    /** الوحدة المجهولة تُرفض (لا معامل مفترَض)؛ الفارغة = وحدة الأساس بمعامل ١. @param array<string, mixed> $entry */
    private function readUnit(array &$entry): void
    {
        $name = trim((string) ($entry['cells']['unit'] ?? ''));
        $entry['requested_unit'] = $name === '' ? null : $name;
        if ($entry['product_id'] === null) {
            return;
        }
        try {
            [$resolved] = $this->units->resolve($entry['product'], $entry['requested_unit']);
            $entry['unit'] = $resolved;
        } catch (RuntimeException $e) {
            $entry['messages'][] = $e->getMessage();
        }
    }

    /** @param array<string, mixed> $entry @param array<string, mixed> $options */
    private function readCost(array &$entry, array $options): void
    {
        if ($options['permit_type'] !== 'receipt') {
            return;
        }
        $text = trim((string) ($entry['cells']['unit_cost'] ?? ''));
        if ($text === '') {
            if (! $options['allow_zero_cost']) {
                $entry['messages'][] = 'تكلفة الوحدة فارغة. أدخلها، أو فعّل «السماح بتكلفة صفر» صراحةً لهذه التشغيلة.';

                return;
            }
            $entry['unit_cost'] = 0;
        } else {
            [$cost, $error] = Normalizer::money($text);
            if ($error !== null || $cost === null) {
                $entry['messages'][] = 'تكلفة الوحدة يجب أن تكون رقماً غير سالب بمنزلتين عشريتين على الأكثر.';

                return;
            }
            if ($cost > Fields::MAX_UNIT_COST) {
                $entry['messages'][] = 'تكلفة الوحدة تتجاوز الحد المسموح.';

                return;
            }
            if ($cost === 0 && ! $options['allow_zero_cost']) {
                $entry['messages'][] = 'تكلفة الوحدة صفر. فعّل «السماح بتكلفة صفر» صراحةً لهذه التشغيلة إن كان مقصوداً (يخفّض متوسط التكلفة).';

                return;
            }
            $entry['unit_cost'] = $cost;
        }
        if ($entry['quantity'] !== null) {
            $entry['line_cost'] = $entry['quantity'] * $entry['unit_cost'];
        }
    }

    /** التصدير يسبق الخلايا التي تبدأ بـ `= + - @` بفاصلة عليا؛ القارئ لا يزيلها فنزيلها هنا ليعمل round-trip لرمز/باركود مثل `-123`. */
    private function unquote(string $value): string
    {
        $value = trim($value);

        return preg_match("/^'[=+\\-@\t\r]/", $value) === 1 ? substr($value, 1) : $value;
    }

    /** @param list<array<string, mixed>> $rows @return list<array{ordinal: int, code: string, message: string}> */
    private function rowFailures(array $rows): array
    {
        $failures = [];
        foreach ($rows as $row) {
            if ($row['valid'] === true) {
                continue;
            }
            $failures[] = ['ordinal' => (int) $row['ordinal'], 'code' => 'row_invalid', 'message' => implode(' · ', array_map('strval', $row['messages']))];
        }

        return $failures;
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function rowSummary(array $row): array
    {
        return [
            'row' => $row['row'], 'action' => $row['action'], 'status' => $row['status'], 'valid' => $row['valid'],
            'sku' => $row['sku'], 'barcode' => $row['barcode'], 'product_name' => $row['name'],
            'quantity' => $row['quantity'], 'unit' => $row['unit'], 'unit_cost' => $row['unit_cost'], 'line_cost' => $row['line_cost'],
            'messages' => $row['messages'], 'warnings' => $row['warnings'],
        ];
    }
}
