<?php

namespace App\Services;

use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Services\Accounting\UnitConversion;
use App\Support\ImportPlanDriftException;
use App\Support\ImportUnitFailureException;
use App\Support\PriceListItemImportFields as Fields;
use App\Support\ProductImportValueNormalizer as Normalizer;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * استيراد عناصر قائمة السعر — IMP-H4-S2. يستخرج منطق ورقة «Unit Prices» في المصنّف إلى مسارٍ مستقلٍّ بوحدة الصفّ؛ الكتابة عبر `PriceListService::upsertItem`
 * وحده (لا اشتقاق سعر من معامل الوحدة ولا سياسة تحقّق جديدة). لا أثر محاسبي ولا مخزني ولا مساس ببطاقة المنتج (سعر البطاقة غير سعر القائمة).
 *
 *  - **القائمة** (`price_list_id`) خيار التشغيلة المجمَّد: موجودة في المؤسسة ونشطة وإلا فشل مغلق؛ لا عمود قائمة في الملف.
 *  - **المنتج:** معرّف نبراكس ثم رمز الصنف (الاسم ليس معرّفاً)، عبر استعلام المنتجات المقيَّد بنطاق المؤسسة والفرع كما يفعل المتحكّم. منتج غير نشط مرفوض.
 *  - **هوية العنصر** (منتج + وحدة): وحدة فارغة = وحدة أساس المنتج؛ وحدة مسمّاة تُحلّ عبر `UnitConversion` (المجهولة تُرفض). تكرار الهوية في الملف — حتى
 *    بصيغتين (معرّف مرة ورمز مرة، أو وحدة فارغة ومسمّاة بالأساس) — يُفشل الملف كله قبل أي كتابة.
 *  - **الأوضاع** `create | update | upsert` (الافتراضي `upsert` = سلوك المصنّف). السعر المطابق للقائم `skip`. السعر بالريال → هللات ≤ سقف `StorePriceListItemRequest`.
 *  - **التزامن:** يُنفَّذ التحليل والكتابة بعد قفل استشاري على القائمة (PostgreSQL) داخل معاملة القطعة؛ قيد القاعدة الفريد يبقى الحارس الأخير.
 *  - وحدة التنفيذ الصفّ؛ النافذة تُحسب على صفوف البيانات الفعلية.
 */
class PriceListItemImportService
{
    public const MODE_CREATE = 'create';
    public const MODE_UPDATE = 'update';
    public const MODE_UPSERT = 'upsert';

    public const MAX_ROWS = 2000;
    public const DURABLE_MAX_ROWS = ProductImportService::DURABLE_MAX_ROWS;
    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;
    private const PREVIEW_ROW_LIMIT = 200;
    private const LOOKUP_CHUNK = 400;
    private const KEY_SEPARATOR = "\x1f";

    private const CELL_ERRORS = [
        'too_long' => 'القيمة تتجاوز الحد المسموح.',
        'invalid_money' => 'السعر يجب أن يكون رقماً غير سالب بمنزلتين عشريتين على الأكثر.',
        'money_out_of_range' => 'السعر يتجاوز النطاق المالي الآمن.',
        'price_out_of_range' => 'السعر يتجاوز الحد الأقصى المسموح لعنصر القائمة.',
        'invalid_nebrax_id' => 'معرّف نبراكس غير صالح.',
    ];

    public function __construct(
        protected PriceListService $priceLists,
        protected UnitConversion $units,
        protected ProductWorkbookService $workbook,
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
            ['', 'SKU-1001', 'قطعة', '25.00'],
            ['', 'SKU-1001', 'كرتون', '280.00'],
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
     * @param  array<string, mixed>  $options
     * @return array{preview: array<string, mixed>, plan: array<int, string>|null}
     */
    public function previewWithPlan(UploadedFile $file, array $options, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);
        $priceList = $this->workbook->resolveActivePriceList($resolved['price_list_id']);
        $parsed = $this->parse($file, $resolved, $priceList, $maxRows);
        $rows = array_slice($parsed['rows'], 0, self::PREVIEW_ROW_LIMIT);

        $preview = [
            'price_list_id' => $priceList->id, 'price_list_name' => $priceList->name, 'mode' => $resolved['mode'], 'mapping' => $parsed['mapping'],
            'total_rows' => $parsed['total_rows'], 'create_rows' => $parsed['counters']['create'], 'update_rows' => $parsed['counters']['update'],
            'skipped_rows' => $parsed['counters']['skip'], 'warning_rows' => $parsed['counters']['warning'], 'error_rows' => $parsed['counters']['error'],
            'valid_rows' => $parsed['total_rows'] - $parsed['counters']['error'], 'invalid_rows' => $parsed['counters']['error'],
            'rows' => array_map(fn (array $row): array => $this->rowSummary($row), $rows),
            'rows_shown' => count($rows), 'rows_truncated' => count($parsed['rows']) > count($rows),
            'errors' => $parsed['errors'],
        ];

        $windowed = $resolved['batch_offset'] > 0 || $resolved['batch_size'] !== null;
        $plan = [];
        foreach ($windowed ? [] : $parsed['rows'] as $row) {
            $plan[(int) $row['row']] = $this->planCode($row);
        }

        return ['preview' => $preview, 'plan' => $windowed ? null : $plan];
    }

    /**
     * يكتب نافذة الصفوف في معاملة واحدة. الملف **كله** يُحلَّل (للتكرار داخله)، والكتابة لصفوف النافذة وحدها.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId = null, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);

        return DB::transaction(function () use ($file, $resolved, $maxRows): array {
            $this->lockPriceList($resolved['price_list_id']);
            // القائمة تُحلّ بعد القفل: تعطيلها أثناء الانتظار يُرى فشلاً مغلقاً لا كتابةً على قائمة معطَّلة.
            $priceList = $this->workbook->resolveActivePriceList($resolved['price_list_id']);
            $parsed = $this->parse($file, $resolved, $priceList, $maxRows);

            if ($parsed['total_rows'] === 0) {
                throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
            }
            if ($resolved['batch_offset'] === 0 && $parsed['file_failures'] !== []) {
                throw new ImportUnitFailureException('لا يمكن تطبيق الاستيراد: تكرار داخل الملف.', $parsed['file_failures']);
            }
            if ($parsed['counters']['error'] > 0) {
                throw new ImportUnitFailureException('لا يمكن تطبيق الاستيراد قبل معالجة الأخطاء الظاهرة في المعاينة.', $this->rowFailures($parsed['rows']));
            }
            if ($resolved['expected_plan'] !== null) {
                foreach ($parsed['rows'] as $row) {
                    $planned = $resolved['expected_plan'][(int) $row['row']] ?? null;
                    $live = $this->planCode($row);
                    if ($planned === null || $planned !== $live) {
                        throw new ImportPlanDriftException((int) $row['row'], $planned, $live);
                    }
                }
            }

            $created = $updated = $skipped = 0;
            $results = [];
            foreach ($parsed['rows'] as $row) {
                if ($row['action'] === 'skip') {
                    $skipped++;
                } else {
                    // الوحدة المطلوبة الخام (قد تكون null) لا المُحلَّلة: `upsertItem` تحلّها بنفسها (انظر تعليق المصنّف).
                    $this->priceLists->upsertItem($priceList, $row['product'], ['unit_name' => $row['requested_unit'], 'price' => $row['price']]);
                    $row['action'] === 'create' ? $created++ : $updated++;
                }
                $results[] = $this->rowSummary($row);
            }

            return [
                'price_list_id' => $priceList->id, 'mode' => $resolved['mode'],
                'created' => $created, 'updated' => $updated, 'skipped' => $skipped,
                'total_rows' => $parsed['total_rows'], 'batch_offset' => $resolved['batch_offset'], 'batch_size' => $resolved['batch_size'],
                'results' => $results,
            ];
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  الخيارات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array{price_list_id: ?string, mode: string, mapping: array<int, string|null>|null, batch_offset: int, batch_size: ?int, expected_plan: array<int, string>|null}
     */
    public function options(array $options): array
    {
        $listId = isset($options['price_list_id']) && is_string($options['price_list_id']) && $options['price_list_id'] !== '' ? $options['price_list_id'] : null;
        if ($listId !== null && ! Str::isUuid($listId)) {
            throw new RuntimeException('معرّف قائمة السعر غير صالح.');
        }
        // صيغة واحدة للمعرّف: PostgreSQL يحلّ UUID بأي حالة أحرف، ومفتاح القفل الاستشاري نصّي فيجب أن يتطابق للقائمة نفسها.
        $listId = $listId === null ? null : mb_strtolower($listId, 'UTF-8');

        $mode = (string) ($options['mode'] ?? self::MODE_UPSERT);
        if (! in_array($mode, [self::MODE_CREATE, self::MODE_UPDATE, self::MODE_UPSERT], true)) {
            throw new RuntimeException('وضع الاستيراد غير صالح.');
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
                    throw new RuntimeException('أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد أسعار القائمة.');
                }
                $mapping[(int) $index] = $key;
            }
        }

        $offset = max(0, (int) ($options['batch_offset'] ?? 0));
        $size = isset($options['batch_size']) ? max(1, (int) $options['batch_size']) : null;
        $plan = isset($options['expected_plan']) && is_array($options['expected_plan']) ? $options['expected_plan'] : null;

        return ['price_list_id' => $listId, 'mode' => $mode, 'mapping' => $mapping, 'batch_offset' => $offset, 'batch_size' => $size, 'expected_plan' => $plan];
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
     * @return array{rows: list<array<string, mixed>>, total_rows: int, mapping: array<int, string|null>, counters: array<string, int>, errors: list<array<string, mixed>>, file_failures: list<array{ordinal: int, code: string, message: string}>}
     */
    private function parse(UploadedFile $file, array $options, PriceList $priceList, int $maxRows): array
    {
        $raw = $this->readFile($file, $maxRows);
        if ($raw === []) {
            throw new RuntimeException('الملف فارغ.');
        }
        $headers = array_map('strval', $raw[0]);
        $mapping = $options['mapping'] ?? Fields::autoMap($headers);
        $this->assertMapping($mapping);

        // 1) كل الصفوف الفعلية: تطبيعٌ بلا قاعدة بيانات.
        $entries = [];
        $ordinal = 0;
        foreach (array_slice($raw, 1, null, true) as $sheetIndex => $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $entry = $this->normalizeRow($values, $mapping);
            $entry['row'] = $sheetIndex + 1;
            $entry['ordinal'] = $ordinal++;
            $entry['codes'] = $entry['errors'];
            $entry['messages'] = array_map(fn (string $code): string => $this->message($code), $entry['errors']);
            $entry['warnings'] = [];
            $entry['file_dup'] = false;
            // صفٌّ أعرض من صف العناوين تسقط قيمةٌ منه صامتةً — أخطر من خطأ صريح.
            if (count($values) > count($headers)) {
                $this->addIssue($entry, 'row_wider_than_header', 'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.');
            }
            $entries[] = $entry;
        }

        // 2) هوية المنتج على الملف كله (أعمدة خفيفة فقط) لاكتشاف التكرار حتى بصيغتين مختلفتين.
        $identity = $this->productIdentities($entries);
        $seen = [];
        $fileFailures = [];
        foreach ($entries as &$entry) {
            $ref = $this->identityOf($entry, $identity);
            if ($ref === null || $entry['messages'] !== []) {
                continue;
            }
            $key = $ref['id'].self::KEY_SEPARATOR.($entry['values']['unit_name'] ?? $ref['unit']);
            if (isset($seen[$key])) {
                $this->addIssue($entry, 'duplicate_in_file', "المنتج والوحدة مكرران داخل الملف (أول ظهور في الصف {$seen[$key]}).");
                $entry['file_dup'] = true;
                $fileFailures[] = ['ordinal' => $entry['ordinal'], 'code' => 'row_duplicate_in_file', 'message' => implode(' · ', $entry['messages'])];
            } else {
                $seen[$key] = $entry['row'];
            }
        }
        unset($entry);

        $total = count($entries);

        // 3) النافذة وحدها تُطابَق بالقاعدة وتُصنَّف.
        $window = array_slice($entries, $options['batch_offset'], $options['batch_size']);
        $this->match($window, $options, $priceList);

        $counters = ['create' => 0, 'update' => 0, 'skip' => 0, 'warning' => 0, 'error' => 0];
        $errors = [];
        foreach ($window as &$entry) {
            $entry['action'] = $this->classify($entry, $options);
            $entry['status'] = $entry['messages'] !== [] ? 'error' : ($entry['warnings'] !== [] ? 'warning' : 'ok');
            if ($entry['messages'] !== []) {
                $entry['action'] = 'error';
                $errors[] = ['row' => $entry['row'], 'messages' => array_values(array_unique($entry['messages']))];
            }
            $counters[$entry['action']]++;
            if ($entry['warnings'] !== [] && $entry['action'] !== 'error') {
                $counters['warning']++;
            }
            $entry['valid'] = $entry['messages'] === [];
        }
        unset($entry);

        return ['rows' => $window, 'total_rows' => $total, 'mapping' => $mapping, 'counters' => $counters, 'errors' => $errors, 'file_failures' => $fileFailures];
    }

    /** @param array<int, string|null> $mapping */
    private function assertMapping(array $mapping): void
    {
        $chosen = array_values(array_filter($mapping, static fn ($key): bool => $key !== null));
        if (count($chosen) !== count(array_unique($chosen))) {
            throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
        }
        if (! in_array('price', $chosen, true)) {
            throw new RuntimeException('الاستيراد يحتاج عمود «السعر».');
        }
        if (! in_array('nebrax_id', $chosen, true) && ! in_array('sku', $chosen, true)) {
            throw new RuntimeException('الاستيراد يحتاج عمود تعريف المنتج: «معرّف نبراكس» أو «رمز الصنف». الاسم لا يصلح معرّفاً.');
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
                continue;
            }
            [$value, $error] = $this->normalizeCell($key, $text);
            if ($error !== null) {
                $errors[] = $error.':'.$key;
                continue;
            }
            $present[$key] = $value;
        }

        return ['values' => $present, 'errors' => $errors, 'product' => null, 'existing' => null, 'price' => $present['price'] ?? null, 'requested_unit' => $present['unit_name'] ?? null];
    }

    /** @return array{0: mixed, 1: ?string} */
    private function normalizeCell(string $key, string $text): array
    {
        $field = Fields::get($key);
        $max = (int) ($field['max'] ?? 255);

        if ($field['type'] === Fields::TYPE_IDENTIFIER) {
            return Str::isUuid($text) ? [mb_strtolower($text, 'UTF-8'), null] : [null, 'invalid_nebrax_id'];
        }
        if ($field['type'] === Fields::TYPE_MONEY) {
            [$value, $error] = Normalizer::money($text);
            if ($error === null && $value > Fields::MAX_PRICE) {
                return [null, 'price_out_of_range'];
            }

            return [$value, $error];
        }

        return mb_strlen($text) > $max ? [null, 'too_long'] : [$text, null];
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
    //  حلّ المنتجات والمطابقة
    // ═══════════════════════════════════════════════════════════════

    /**
     * أعمدة خفيفة (المعرّف، الرمز، وحدة الأساس) لكل منتج مذكور في الملف كله.
     *
     * @param  list<array<string, mixed>>  $entries
     * @return array{byId: array<string, array{id: string, unit: string}>, bySku: array<string, array{id: string, unit: string}>}
     */
    private function productIdentities(array $entries): array
    {
        $ids = $skus = [];
        foreach ($entries as $entry) {
            if (isset($entry['values']['nebrax_id'])) {
                $ids[$entry['values']['nebrax_id']] = true;
            }
            if (isset($entry['values']['sku'])) {
                $skus[(string) $entry['values']['sku']] = true;
            }
        }

        $byId = $bySku = [];
        foreach (array_chunk(array_keys($ids), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->whereIn('id', $chunk)->get(['id', 'sku', 'unit']) as $product) {
                $byId[mb_strtolower((string) $product->id, 'UTF-8')] = ['id' => (string) $product->id, 'unit' => (string) $product->unit];
            }
        }
        foreach (array_chunk(array_keys($skus), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->whereIn('sku', $chunk)->get(['id', 'sku', 'unit']) as $product) {
                $bySku[(string) $product->sku] = ['id' => (string) $product->id, 'unit' => (string) $product->unit];
            }
        }

        return ['byId' => $byId, 'bySku' => $bySku];
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  array{byId: array<string, array{id: string, unit: string}>, bySku: array<string, array{id: string, unit: string}>}  $identity
     * @return array{id: string, unit: string}|null
     */
    private function identityOf(array $entry, array $identity): ?array
    {
        $byId = isset($entry['values']['nebrax_id']) ? ($identity['byId'][$entry['values']['nebrax_id']] ?? null) : null;
        $bySku = isset($entry['values']['sku']) ? ($identity['bySku'][(string) $entry['values']['sku']] ?? null) : null;
        if ($byId !== null && $bySku !== null && $byId['id'] !== $bySku['id']) {
            return null;
        }

        return $byId ?? $bySku;
    }

    /**
     * @param  list<array<string, mixed>>  $entries  تُعدَّل بالمرجع: المنتج/العنصر القائم/أخطاء المطابقة.
     * @param  array<string, mixed>  $options
     */
    private function match(array &$entries, array $options, PriceList $priceList): void
    {
        $ids = $skus = [];
        foreach ($entries as $entry) {
            if (isset($entry['values']['nebrax_id'])) {
                $ids[$entry['values']['nebrax_id']] = true;
            }
            if (isset($entry['values']['sku'])) {
                $skus[(string) $entry['values']['sku']] = true;
            }
        }
        $byId = $bySku = [];
        foreach (array_chunk(array_keys($ids), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->with('unitTemplate.units')->whereIn('id', $chunk)->get() as $product) {
                $byId[mb_strtolower((string) $product->id, 'UTF-8')] = $product;
            }
        }
        foreach (array_chunk(array_keys($skus), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Product::query()->with('unitTemplate.units')->whereIn('sku', $chunk)->get() as $product) {
                $bySku[(string) $product->sku] = $product;
            }
        }

        $items = [];
        $productIds = array_values(array_unique(array_merge(array_map(fn (Product $p): string => (string) $p->id, $byId), array_map(fn (Product $p): string => (string) $p->id, $bySku))));
        foreach (array_chunk($productIds, self::LOOKUP_CHUNK) as $chunk) {
            foreach (PriceListItem::query()->where('price_list_id', $priceList->id)->whereNull('product_variant_id')->whereIn('product_id', $chunk)->get() as $item) {
                $items[$item->product_id.self::KEY_SEPARATOR.$item->unit_name] = $item;
            }
        }

        foreach ($entries as &$entry) {
            if ($entry['messages'] !== []) {
                continue;
            }
            $entry['product'] = $this->resolveProduct($entry, $byId, $bySku);
            if ($entry['product'] === null) {
                continue;
            }
            /** @var Product $product */
            $product = $entry['product'];
            if (! $product->is_active) {
                $this->addIssue($entry, 'product_inactive', 'لا يمكن إضافة منتج غير نشط إلى قائمة الأسعار.');
                continue;
            }
            try {
                [$resolvedUnit] = $this->units->resolve($product, $entry['requested_unit']);
            } catch (RuntimeException $exception) {
                $this->addIssue($entry, 'unit_invalid', $exception->getMessage());
                continue;
            }
            $entry['stored_unit'] = $resolvedUnit ?? (string) $product->unit;
            $entry['existing'] = $items[$product->id.self::KEY_SEPARATOR.$entry['stored_unit']] ?? null;
        }
        unset($entry);
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  array<string, Product>  $byId
     * @param  array<string, Product>  $bySku
     */
    private function resolveProduct(array &$entry, array $byId, array $bySku): ?Product
    {
        $viaId = isset($entry['values']['nebrax_id']) ? ($byId[$entry['values']['nebrax_id']] ?? null) : null;
        $viaSku = isset($entry['values']['sku']) ? ($bySku[(string) $entry['values']['sku']] ?? null) : null;

        if (isset($entry['values']['nebrax_id']) && $viaId === null) {
            $this->addIssue($entry, 'product_not_found', 'معرّف نبراكس لا يطابق أي منتج في نطاقك.');

            return null;
        }
        if (! isset($entry['values']['nebrax_id']) && isset($entry['values']['sku']) && $viaSku === null) {
            $this->addIssue($entry, 'product_not_found', 'رمز الصنف لا يطابق أي منتج في نطاقك.');

            return null;
        }
        if ($viaId === null && $viaSku === null) {
            $this->addIssue($entry, 'product_required', 'الصف يحتاج معرّف نبراكس أو رمز الصنف لتحديد المنتج المستهدف.');

            return null;
        }
        if ($viaId !== null && isset($entry['values']['sku']) && ($viaSku === null || (string) $viaSku->id !== (string) $viaId->id)) {
            $this->addIssue($entry, 'identifier_conflict', 'معرّف نبراكس ورمز الصنف يشيران إلى منتجين مختلفين؛ صحّح الصف أو تخطَّه.');

            return null;
        }

        return $viaId ?? $viaSku;
    }

    // ═══════════════════════════════════════════════════════════════
    //  التصنيف
    // ═══════════════════════════════════════════════════════════════

    /** @param array<string, mixed> $entry @param array<string, mixed> $options */
    private function classify(array &$entry, array $options): string
    {
        if ($entry['messages'] !== []) {
            return 'error';
        }
        if (! isset($entry['values']['price'])) {
            $this->addIssue($entry, 'price_required', 'السعر مطلوب.');

            return 'error';
        }
        $existing = $entry['existing'];
        if ($existing === null) {
            if ($options['mode'] === self::MODE_UPDATE) {
                $this->addIssue($entry, 'update_target_missing', 'لا يوجد سعر لهذا المنتج والوحدة في القائمة؛ لا يمكن التحديث.');

                return 'error';
            }

            return 'create';
        }
        if ($options['mode'] === self::MODE_CREATE) {
            $this->addIssue($entry, 'existing_item', 'للمنتج والوحدة سعرٌ في القائمة بالفعل. اختر «تحديث» أو «دمج» بدل الإنشاء.');

            return 'error';
        }

        return (int) $existing->price === (int) $entry['price'] ? 'skip' : 'update';
    }

    /** @param array<string, mixed> $row */
    private function planCode(array $row): string
    {
        $existing = $row['existing'] ?? null;

        return match ($row['action']) {
            'create' => 'c',
            'update' => 'u:'.($existing?->id ?? ''),
            'skip' => 's:'.($existing?->id ?? ''),
            default => 'e',
        };
    }

    /** @param list<array<string, mixed>> $rows @return list<array{ordinal: int, code: string, message: string}> */
    private function rowFailures(array $rows): array
    {
        $failures = [];
        foreach ($rows as $row) {
            if (($row['valid'] ?? true) === true) {
                continue;
            }
            $failures[] = ['ordinal' => (int) $row['ordinal'], 'code' => 'row_invalid', 'message' => implode(' · ', array_map('strval', $row['messages']))];
        }

        return $failures;
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function rowSummary(array $row): array
    {
        /** @var Product|null $product */
        $product = $row['product'] ?? null;

        return [
            'row' => $row['row'], 'action' => $row['action'], 'status' => $row['status'], 'valid' => $row['valid'],
            'sku' => $product?->sku ?? $row['values']['sku'] ?? null,
            'product_name' => $product?->name,
            'unit' => $row['stored_unit'] ?? $row['requested_unit'],
            'price' => $row['price'],
            'current_price' => ($row['existing'] ?? null) !== null ? (int) $row['existing']->price : null,
            'messages' => $row['messages'], 'warnings' => $row['warnings'],
        ];
    }

    /** قفل استشاري على القائمة (PostgreSQL) داخل المعاملة؛ لا أثر على SQLite (كتابته متسلسلة أصلاً). */
    private function lockPriceList(?string $priceListId): void
    {
        $connection = DB::connection();
        if ($priceListId === null || $connection->getDriverName() !== 'pgsql') {
            return;
        }
        if ($connection->transactionLevel() < 1) {
            throw new \LogicException('قفل استيراد أسعار القائمة يتطلب معاملة نشطة.');
        }
        $connection->select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['price-list-import:'.app(TenantContext::class)->id().':'.$priceListId]);
    }
}
