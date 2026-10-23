<?php

namespace App\Services;

use App\Models\Brand;
use App\Models\ProductCategory;
use App\Support\ImportPlanDriftException;
use App\Support\ImportUnitFailureException;
use App\Support\ProductImportValueNormalizer as Normalizer;
use App\Support\ProductTaxonomyImportFields as Fields;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * استيراد تصنيفات المنتجات وعلاماتها التجارية — IMP-H4-S1. يكتب **صفاً صفاً** بقواعد المتحكّمين نفسها (`ProductCategoryController`/`BrandController`)
 * دون المرور بهما؛ لا أثر محاسبي ولا مخزني ولا مساس بالمنتجات.
 *
 *  - **النوع** (`kind` = category|brand) يحدّده مدخل الاستيراد.
 *  - **الهوية:** معرّف نبراكس يتقدّم دائماً؛ وإلا فمسار التصنيف (الأب + الاسم، فريد بين الإخوة) أو اسم العلامة (فريد على المؤسسة). التفرّد يُفحص على المؤسسة
 *    كلها (لا الفرع النشط وحده) كالمتحكّمين، والأب يجب أن يكون مرئياً للمستخدم (كما يشترط المتحكّم).
 *  - **المسار:** عمود «مسار التصنيف الأب» بفاصل `>` (أو `›`/`»`)؛ الاسم لا يحمل فاصلاً. المستويات ≤ `MAX_DEPTH`. لا دورة ممكنة لأن الاستيراد ينشئ فقط.
 *  - **سياسة الآباء** (`parent_policy`): `error` (الافتراضي — الأب موجود أو سطرٌ سابق في الملف) أو `create_missing` (يُنشأ الأب الناقص نشطاً بلا وصف).
 *  - **لا إعادة تسمية ولا نقل** لعنصر قائم (اسمٌ/أبٌ يخالف المخزَّن = `identity_locked`)؛ التحديث يطال الوصف واللون والحالة وحدها.
 *  - **التزامن:** التفرّد فحصٌ تطبيقي (لا قيد قاعدة)، فتُنفَّذ كل قطعة تحت قفل استشاري على المستأجر (PostgreSQL) داخل معاملتها.
 *  - وحدة التنفيذ الصفّ؛ النافذة تُحسب على صفوف البيانات الفعلية. الآباء الضمنيون ينشئهم أول صفٍّ يحتاجهم (في نافذته).
 */
class ProductTaxonomyImportService
{
    public const MODE_CREATE = 'create';
    public const MODE_UPDATE = 'update';
    public const MODE_UPSERT = 'upsert';

    public const BLANK_IGNORE = 'ignore';
    public const BLANK_CLEAR = 'clear';

    public const PARENT_ERROR = 'error';
    public const PARENT_CREATE = 'create_missing';

    public const MAX_ROWS = 2000;
    public const DURABLE_MAX_ROWS = ProductImportService::DURABLE_MAX_ROWS;
    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;
    private const PREVIEW_ROW_LIMIT = 200;
    private const KEY_SEPARATOR = "\x1f";

    private const CELL_ERRORS = [
        'too_long' => 'القيمة تتجاوز الحد المسموح.',
        'invalid_boolean' => 'القيمة تقبل نعم/لا أو 1/0 أو true/false.',
        'invalid_nebrax_id' => 'معرّف نبراكس غير صالح.',
        'invalid_color' => 'اللون يجب أن يكون بصيغة #RRGGBB.',
        'invalid_path' => 'مسار الأب غير صالح (مستوى فارغ).',
        'path_too_deep' => 'المسار يتجاوز الحد الأقصى للمستويات.',
        'name_has_separator' => 'اسم التصنيف لا يحمل فاصل المسار (> أو › أو »).',
    ];

    // ═══════════════════════════════════════════════════════════════
    //  العقد والقالب والفحص
    // ═══════════════════════════════════════════════════════════════

    /** @return list<array<string, mixed>> */
    public function fieldContract(string $kind): array
    {
        $contract = [];
        foreach (Fields::all($kind) as $key => $field) {
            $contract[] = [
                'key' => $key, 'label_ar' => $field['label_ar'], 'label_en' => $field['label_en'], 'type' => $field['type'],
                'required' => (bool) $field['required'], 'clearable' => (bool) $field['clearable'], 'writable' => (bool) $field['writable'],
            ];
        }

        return $contract;
    }

    public function template(string $kind): string
    {
        $keys = Fields::keys($kind);
        $example = static fn (array $values): array => array_map(static fn (string $key): string => $values[$key] ?? '', $keys);

        $rows = $kind === Fields::KIND_BRAND
            ? [$example(['name' => 'تويوتا', 'is_active' => 'نعم']), $example(['name' => 'هيونداي'])]
            : [
                $example(['name' => 'زيوت', 'description' => 'زيوت المحركات والتروس', 'color' => '#1F7A8C', 'is_active' => 'نعم']),
                $example(['name' => 'فلاتر', 'parent_path' => 'زيوت']),
                $example(['name' => 'فلاتر هواء', 'parent_path' => 'زيوت > فلاتر']),
            ];

        return SpreadsheetWriter::csv(Fields::templateHeaders($kind), $rows);
    }

    /** @return array{columns: list<array<string, mixed>>, total_rows: int, fields: list<array<string, mixed>>} */
    public function inspect(UploadedFile $file, string $kind, int $maxRows = self::MAX_ROWS): array
    {
        Fields::assertKind($kind);
        $rows = $this->readFile($file, $maxRows);
        $headers = array_map('strval', $rows[0] ?? []);
        $mapping = Fields::autoMap($kind, $headers);
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

        return ['columns' => $columns, 'total_rows' => count($data), 'fields' => $this->fieldContract($kind)];
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
        $parsed = $this->parse($file, $resolved, $maxRows);
        $rows = array_slice($parsed['rows'], 0, self::PREVIEW_ROW_LIMIT);

        $preview = [
            'kind' => $resolved['kind'], 'mode' => $resolved['mode'], 'blank_policy' => $resolved['blank_policy'], 'parent_policy' => $resolved['parent_policy'],
            'mapping' => $parsed['mapping'],
            'total_rows' => $parsed['total_rows'], 'create_rows' => $parsed['counters']['create'], 'update_rows' => $parsed['counters']['update'],
            'skipped_rows' => $parsed['counters']['skip'], 'warning_rows' => $parsed['counters']['warning'], 'error_rows' => $parsed['counters']['error'],
            'valid_rows' => $parsed['total_rows'] - $parsed['counters']['error'], 'invalid_rows' => $parsed['counters']['error'],
            'implicit_parents' => $parsed['implicit_parents'],
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
     * يكتب نافذة الصفوف في معاملة واحدة. الملف **كله** يُحلَّل (للتكرار داخل الملف)، والكتابة لصفوف النافذة وحدها.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId = null, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);

        return DB::transaction(function () use ($file, $resolved, $maxRows): array {
            // القفل قبل التحليل: ما يراه التحليل هو ما سيُكتب (التفرّد فحصٌ تطبيقي بلا قيد قاعدة).
            $this->lockTenant();
            $parsed = $this->parse($file, $resolved, $maxRows);

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

            $writer = $resolved['kind'] === Fields::KIND_BRAND ? $this->applyBrands($parsed['rows']) : $this->applyCategories($parsed['rows']);
            $results = array_map(fn (array $row): array => $this->rowSummary($row), $parsed['rows']);

            return [
                'kind' => $resolved['kind'], 'mode' => $resolved['mode'], 'blank_policy' => $resolved['blank_policy'], 'parent_policy' => $resolved['parent_policy'],
                'created' => $writer['created'], 'updated' => $writer['updated'], 'skipped' => $writer['skipped'], 'implicit_parents_created' => $writer['implicit'],
                'total_rows' => $parsed['total_rows'], 'batch_offset' => $resolved['batch_offset'], 'batch_size' => $resolved['batch_size'],
                'results' => $results,
            ];
        });
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{created: int, updated: int, skipped: int, implicit: int}
     */
    private function applyBrands(array $rows): array
    {
        $created = $updated = $skipped = 0;
        $models = Brand::query()->get()->keyBy(static fn (Brand $brand): string => (string) $brand->id);
        foreach ($rows as $row) {
            if ($row['action'] === 'skip') {
                $skipped++;
            } elseif ($row['action'] === 'update') {
                $models[(string) $row['target']]->update($row['payload']);
                $updated++;
            } else {
                Brand::create($row['payload']);
                $created++;
            }
        }

        return ['created' => $created, 'updated' => $updated, 'skipped' => $skipped, 'implicit' => 0];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{created: int, updated: int, skipped: int, implicit: int}
     */
    private function applyCategories(array $rows): array
    {
        $created = $updated = $skipped = $implicit = 0;
        $tree = $this->categoryTree();
        /** @var array<string, ProductCategory> $models */
        $models = $tree['models'];
        $children = $tree['children'];

        foreach ($rows as $row) {
            if ($row['action'] === 'skip') {
                $skipped++;
                continue;
            }
            if ($row['action'] === 'update') {
                // الهدف إما معرّف قائم وإما مسارٌ أنشأه صفٌّ سابق في هذه المعاملة.
                $id = $row['target_is_node'] ? (string) $row['target'] : ($children[$this->parentKeyOf($row['segments'], $children)][$row['leaf']] ?? null);
                if ($id === null || ! isset($models[$id])) {
                    throw new RuntimeException('تعذّر تحديد التصنيف المراد تحديثه.');
                }
                $models[$id]->update($row['payload']);
                $updated++;
                continue;
            }

            $parent = '';
            foreach ($row['segments'] as $segment) {
                $next = $children[$parent][$segment] ?? null;
                if ($next === null) {
                    // نفس قرار التحليل: الأب الناقص لا يصل إلى هنا إلا بسياسة `create_missing`.
                    if ($row['parent_policy'] !== self::PARENT_CREATE) {
                        throw new RuntimeException('التصنيف الأب غير موجود.');
                    }
                    $model = ProductCategory::create(['name' => $segment, 'parent_id' => $parent === '' ? null : $parent, 'is_active' => true]);
                    $next = (string) $model->id;
                    $models[$next] = $model;
                    $children[$parent][$segment] = $next;
                    $implicit++;
                }
                $parent = $next;
            }
            $model = ProductCategory::create($row['payload'] + ['parent_id' => $parent === '' ? null : $parent]);
            $models[(string) $model->id] = $model;
            $children[$parent][$row['leaf']] = (string) $model->id;
            $created++;
        }

        return ['created' => $created, 'updated' => $updated, 'skipped' => $skipped, 'implicit' => $implicit];
    }

    /** @param list<string> $segments @param array<string, array<string, string>> $children */
    private function parentKeyOf(array $segments, array $children): string
    {
        $cursor = '';
        foreach ($segments as $segment) {
            $cursor = $children[$cursor][$segment] ?? '';
        }

        return $cursor;
    }

    // ═══════════════════════════════════════════════════════════════
    //  الخيارات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array{kind: string, mode: string, blank_policy: string, parent_policy: string, mapping: array<int, string|null>|null, batch_offset: int, batch_size: ?int, expected_plan: array<int, string>|null}
     */
    public function options(array $options): array
    {
        $kind = (string) ($options['kind'] ?? '');
        Fields::assertKind($kind);

        $mode = (string) ($options['mode'] ?? self::MODE_CREATE);
        if (! in_array($mode, [self::MODE_CREATE, self::MODE_UPDATE, self::MODE_UPSERT], true)) {
            throw new RuntimeException('وضع الاستيراد غير صالح.');
        }
        $blank = (string) ($options['blank_policy'] ?? self::BLANK_IGNORE);
        if (! in_array($blank, [self::BLANK_IGNORE, self::BLANK_CLEAR], true)) {
            throw new RuntimeException('سياسة القيم الفارغة غير صالحة.');
        }
        $parentPolicy = (string) ($options['parent_policy'] ?? self::PARENT_ERROR);
        if (! in_array($parentPolicy, [self::PARENT_ERROR, self::PARENT_CREATE], true)) {
            throw new RuntimeException('سياسة التصنيفات الآباء غير صالحة.');
        }
        // العلامات قائمة مسطّحة: لا آباء، فالسياسة بلا معنى وتُثبَّت.
        if ($kind === Fields::KIND_BRAND) {
            $parentPolicy = self::PARENT_ERROR;
        }

        $mapping = null;
        if (isset($options['mapping']) && is_array($options['mapping'])) {
            $mapping = [];
            foreach ($options['mapping'] as $index => $key) {
                if (! is_numeric($index)) {
                    continue;
                }
                $key = $key === null || $key === '' || $key === 'ignore' ? null : (string) $key;
                if ($key !== null && Fields::get($kind, $key) === null) {
                    throw new RuntimeException('أحد الأعمدة مربوط بحقل غير معروف في عقد هذا الاستيراد.');
                }
                $mapping[(int) $index] = $key;
            }
        }

        $offset = max(0, (int) ($options['batch_offset'] ?? 0));
        $size = isset($options['batch_size']) ? max(1, (int) $options['batch_size']) : null;
        $plan = isset($options['expected_plan']) && is_array($options['expected_plan']) ? $options['expected_plan'] : null;

        return [
            'kind' => $kind, 'mode' => $mode, 'blank_policy' => $blank, 'parent_policy' => $parentPolicy,
            'mapping' => $mapping, 'batch_offset' => $offset, 'batch_size' => $size, 'expected_plan' => $plan,
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
     * @return array{rows: list<array<string, mixed>>, total_rows: int, mapping: array<int, string|null>, counters: array<string, int>, errors: list<array<string, mixed>>, file_failures: list<array{ordinal: int, code: string, message: string}>, implicit_parents: int}
     */
    private function parse(UploadedFile $file, array $options, int $maxRows): array
    {
        $raw = $this->readFile($file, $maxRows);
        if ($raw === []) {
            throw new RuntimeException('الملف فارغ.');
        }
        $kind = $options['kind'];
        $headers = array_map('strval', $raw[0]);
        $mapping = $options['mapping'] ?? Fields::autoMap($kind, $headers);
        $this->assertMapping($mapping, $options['mode']);

        // 1) كل الصفوف الفعلية: تطبيعٌ بلا قاعدة بيانات + تتبّع التكرار داخل الملف.
        $entries = [];
        $seen = ['nebrax_id' => [], 'path' => []];
        $ordinal = 0;
        foreach (array_slice($raw, 1, null, true) as $sheetIndex => $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $entry = $this->normalizeRow($kind, $values, $mapping);
            $entry['row'] = $sheetIndex + 1;
            $entry['ordinal'] = $ordinal++;
            $entry['codes'] = $entry['errors'];
            $entry['messages'] = array_map(fn (string $code): string => $this->message($kind, $code), $entry['errors']);
            $entry['warnings'] = [];
            $entry['file_dup'] = false;
            // صفٌّ أعرض من صف العناوين تسقط قيمةٌ منه صامتةً (فاصلة غير مقتبَسة مثلاً) — أخطر من خطأ صريح.
            if (count($values) > count($headers)) {
                $this->addIssue($entry, 'row_wider_than_header', 'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.');
            }

            $identity = [
                'nebrax_id' => $entry['values']['nebrax_id'] ?? null,
                'path' => isset($entry['values']['name']) ? $this->pathKey($entry['segments'], (string) $entry['values']['name']) : null,
            ];
            foreach ($identity as $key => $value) {
                if ($value === null) {
                    continue;
                }
                if (isset($seen[$key][$value])) {
                    $this->addIssue($entry, 'duplicate_in_file', ($key === 'path' ? ($kind === Fields::KIND_BRAND ? 'الاسم' : 'المسار') : 'معرّف نبراكس')." مكرر داخل الملف (أول ظهور في الصف {$seen[$key][$value]}).");
                    $entry['file_dup'] = true;
                } else {
                    $seen[$key][$value] = $entry['row'];
                }
            }
            $entries[] = $entry;
        }

        $total = count($entries);
        $fileFailures = [];
        foreach ($entries as $entry) {
            if ($entry['file_dup']) {
                $fileFailures[] = ['ordinal' => $entry['ordinal'], 'code' => 'row_duplicate_in_file', 'message' => implode(' · ', $entry['messages'])];
            }
        }

        // 2) النافذة وحدها تُطابَق بالقاعدة وتُصنَّف بالترتيب (الآباء الضمنيون وما أنشأه صفٌّ سابق يراه اللاحق).
        $window = array_slice($entries, $options['batch_offset'], $options['batch_size']);
        $implicit = $kind === Fields::KIND_BRAND ? $this->classifyBrands($window, $options) : $this->classifyCategories($window, $options);

        $counters = ['create' => 0, 'update' => 0, 'skip' => 0, 'warning' => 0, 'error' => 0];
        $errors = [];
        foreach ($window as &$entry) {
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

        return ['rows' => $window, 'total_rows' => $total, 'mapping' => $mapping, 'counters' => $counters, 'errors' => $errors, 'file_failures' => $fileFailures, 'implicit_parents' => $implicit];
    }

    /** @param array<int, string|null> $mapping */
    private function assertMapping(array $mapping, string $mode): void
    {
        $chosen = array_values(array_filter($mapping, static fn ($key): bool => $key !== null));
        if (count($chosen) !== count(array_unique($chosen))) {
            throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
        }
        if (in_array($mode, [self::MODE_CREATE, self::MODE_UPSERT], true) && ! in_array('name', $chosen, true)) {
            throw new RuntimeException('الإنشاء يحتاج عمود «الاسم».');
        }
        if ($mode === self::MODE_UPDATE && ! in_array('name', $chosen, true) && ! in_array('nebrax_id', $chosen, true)) {
            throw new RuntimeException('التحديث يحتاج عمود «الاسم» أو «معرّف نبراكس».');
        }
    }

    /**
     * @param  array<int, string>  $values
     * @param  array<int, string|null>  $mapping
     * @return array<string, mixed>
     */
    private function normalizeRow(string $kind, array $values, array $mapping): array
    {
        $present = [];
        $blank = [];
        $errors = [];
        $segments = [];
        foreach ($mapping as $index => $key) {
            if ($key === null) {
                continue;
            }
            $text = trim((string) ($values[$index] ?? ''));
            if ($text === '') {
                $blank[$key] = true;
                continue;
            }
            [$value, $error] = $this->normalizeCell($kind, $key, $text);
            if ($error !== null) {
                $errors[] = $error.':'.$key;
                continue;
            }
            if ($key === 'parent_path') {
                $segments = $value;
                $present[$key] = true;
                continue;
            }
            $present[$key] = $value;
        }
        return ['values' => $present, 'blank' => $blank, 'errors' => $errors, 'segments' => $segments, 'target' => null, 'payload' => []];
    }

    /** @return array{0: mixed, 1: ?string} */
    private function normalizeCell(string $kind, string $key, string $text): array
    {
        $field = Fields::get($kind, $key);
        $max = (int) ($field['max'] ?? 255);

        return match ($field['type']) {
            Fields::TYPE_IDENTIFIER => Str::isUuid($text) ? [mb_strtolower($text, 'UTF-8'), null] : [null, 'invalid_nebrax_id'],
            Fields::TYPE_BOOLEAN => Normalizer::boolean($text),
            Fields::TYPE_COLOR => preg_match(ProductCategory::COLOR_REGEX, $text) === 1 ? [$text, null] : [null, 'invalid_color'],
            Fields::TYPE_PATH => $this->path($text),
            default => $this->name($kind, $key, $text, $max),
        };
    }

    /** @return array{0: ?string, 1: ?string} */
    private function name(string $kind, string $key, string $text, int $max): array
    {
        if (mb_strlen($text) > $max) {
            return [null, 'too_long'];
        }
        if ($kind === Fields::KIND_CATEGORY && $key === 'name' && preg_match('/[>›»]/u', $text) === 1) {
            return [null, 'name_has_separator'];
        }

        return [$text, null];
    }

    /** @return array{0: ?list<string>, 1: ?string} */
    private function path(string $text): array
    {
        $segments = array_map('trim', preg_split('/[>›»]/u', $text) ?: []);
        foreach ($segments as $segment) {
            if ($segment === '') {
                return [null, 'invalid_path'];
            }
            if (mb_strlen($segment) > 255) {
                return [null, 'too_long'];
            }
        }
        if (count($segments) >= Fields::MAX_DEPTH) {
            return [null, 'path_too_deep'];
        }

        return [$segments, null];
    }

    private function message(string $kind, string $code): string
    {
        [$base, $field] = array_pad(explode(':', $code, 2), 2, null);
        $label = $field !== null && Fields::get($kind, $field) !== null ? '«'.Fields::get($kind, $field)['label_ar'].'»: ' : '';

        return $label.(self::CELL_ERRORS[$base] ?? 'قيمة غير صالحة.');
    }

    /** @param array<string, mixed> $entry */
    private function addIssue(array &$entry, string $code, string $message): void
    {
        $entry['codes'][] = $code;
        $entry['messages'][] = $message;
    }

    /** @param list<string> $segments */
    private function pathKey(array $segments, string $name): string
    {
        return implode(self::KEY_SEPARATOR, [...$segments, $name]);
    }

    /** @param list<string> $segments */
    private function pathLabel(array $segments, string $name): string
    {
        return implode(' > ', [...$segments, $name]);
    }

    // ═══════════════════════════════════════════════════════════════
    //  التصنيف والمطابقة — العلامات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  list<array<string, mixed>>  $entries
     * @param  array<string, mixed>  $options
     */
    private function classifyBrands(array &$entries, array $options): int
    {
        $models = Brand::query()->get()->keyBy(static fn (Brand $brand): string => (string) $brand->id);
        $byName = [];
        foreach (BranchScope::reference(Brand::class)->get(['id', 'name']) as $brand) {
            $byName[(string) $brand->name] = (string) $brand->id;
        }

        foreach ($entries as &$entry) {
            $entry['action'] = 'error';
            $entry['kind'] = Fields::KIND_BRAND;
            $entry['parent_policy'] = self::PARENT_ERROR;
            if ($entry['messages'] !== []) {
                continue;
            }
            $existing = $this->matchBrand($entry, $models, $byName);
            if ($entry['messages'] !== []) {
                continue;
            }
            $entry['target'] = $existing?->id;
            $entry['leaf'] = (string) ($existing?->name ?? $entry['values']['name'] ?? '');

            if ($existing === null) {
                $this->classifyMissing($entry, $options, 'علامة');
                if ($entry['messages'] === []) {
                    $entry['payload'] = ['name' => $entry['values']['name'], 'is_active' => $entry['values']['is_active'] ?? true];
                    $entry['action'] = 'create';
                    $byName[(string) $entry['values']['name']] = 'pending';
                }
                continue;
            }
            $this->classifyExisting($entry, $options, $existing, 'العلامة «'.$existing->name.'»');
        }
        unset($entry);

        return 0;
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  \Illuminate\Support\Collection<string, Brand>  $models
     * @param  array<string, string>  $byName
     */
    private function matchBrand(array &$entry, $models, array $byName): ?Brand
    {
        if (isset($entry['values']['nebrax_id'])) {
            $model = $models[$entry['values']['nebrax_id']] ?? null;
            if ($model === null) {
                $this->addIssue($entry, 'target_not_found', 'معرّف نبراكس لا يطابق أي علامة في نطاقك.');

                return null;
            }
            if (isset($entry['values']['name']) && (string) $entry['values']['name'] !== (string) $model->name) {
                $this->addIssue($entry, 'identity_locked', 'الاستيراد لا يعيد تسمية علامة قائمة؛ عدّل الاسم من شاشة العلامات.');

                return null;
            }

            return $model;
        }
        if (! isset($entry['values']['name'])) {
            $this->addIssue($entry, 'identifier_required', 'يلزم «الاسم» أو «معرّف نبراكس» لتحديد العلامة.');

            return null;
        }
        $id = $byName[(string) $entry['values']['name']] ?? null;
        if ($id === null) {
            return null;
        }
        $model = $models[$id] ?? null;
        if ($model === null) {
            $this->addIssue($entry, $id === 'pending' ? 'duplicate_in_file' : 'exists_not_visible', $id === 'pending'
                ? 'الاسم مكرر داخل الملف.'
                : 'توجد علامة بهذا الاسم في مؤسستك خارج نطاق فرعك؛ لا يمكن إنشاؤها ولا تحديثها من هنا.');

            return null;
        }

        return $model;
    }

    // ═══════════════════════════════════════════════════════════════
    //  التصنيف والمطابقة — التصنيفات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @return array{models: array<string, ProductCategory>, children: array<string, array<string, string>>, info: array<string, array{parent: string, name: string}>}
     */
    private function categoryTree(): array
    {
        $models = [];
        foreach (ProductCategory::query()->get() as $model) {
            $models[(string) $model->id] = $model;
        }
        $children = [];
        $info = [];
        // التفرّد على المؤسسة كلها (كالمتحكّم)؛ المرئيّ منها وحده يُحدَّث أو يصلح أباً.
        foreach (BranchScope::reference(ProductCategory::class)->get(['id', 'parent_id', 'name']) as $row) {
            $parent = $row->parent_id === null ? '' : (string) $row->parent_id;
            $children[$parent][(string) $row->name] = (string) $row->id;
            $info[(string) $row->id] = ['parent' => $parent, 'name' => (string) $row->name];
        }

        return ['models' => $models, 'children' => $children, 'info' => $info];
    }

    /**
     * @param  list<array<string, mixed>>  $entries
     * @param  array<string, mixed>  $options
     * @return int عدد الآباء الضمنيين الذين ستنشئهم النافذة
     */
    private function classifyCategories(array &$entries, array $options): int
    {
        $tree = $this->categoryTree();
        $models = $tree['models'];
        $children = $tree['children'];
        $info = $tree['info'];
        $virtual = 0;
        $implicit = 0;

        foreach ($entries as &$entry) {
            $entry['action'] = 'error';
            $entry['kind'] = Fields::KIND_CATEGORY;
            $entry['parent_policy'] = $options['parent_policy'];
            $entry['leaf'] = (string) ($entry['values']['name'] ?? '');
            $entry['target_is_node'] = true;
            $entry['creates_parents'] = [];
            if ($entry['messages'] !== []) {
                continue;
            }

            $existing = null;
            $pending = [];
            if (isset($entry['values']['nebrax_id'])) {
                $id = $entry['values']['nebrax_id'];
                $existing = $models[$id] ?? null;
                if ($existing === null) {
                    $this->addIssue($entry, 'target_not_found', 'معرّف نبراكس لا يطابق أي تصنيف في نطاقك.');
                    continue;
                }
                $path = $this->nodePath($id, $info);
                $leaf = array_pop($path);
                if (isset($entry['values']['name']) && (string) $entry['values']['name'] !== $leaf
                    || isset($entry['values']['parent_path']) && $entry['segments'] !== $path) {
                    $this->addIssue($entry, 'identity_locked', 'الاستيراد لا يعيد تسمية تصنيف قائم ولا ينقله؛ عدّل الاسم أو الأب من شاشة التصنيفات.');
                    continue;
                }
                $entry['segments'] = $path;
                $entry['leaf'] = $leaf;
                $entry['target'] = $id;
            } else {
                if (! isset($entry['values']['name'])) {
                    $this->addIssue($entry, 'identifier_required', 'يلزم «الاسم» أو «معرّف نبراكس» لتحديد التصنيف.');
                    continue;
                }
                [$walkCursor, $pending, $problem] = $this->walkParents($entry['segments'], $children, $models, $options['parent_policy']);
                if ($problem !== null) {
                    $this->addIssue($entry, $problem[0], $problem[1]);
                    continue;
                }
                $leafKey = $pending === [] ? ($children[$walkCursor][$entry['leaf']] ?? null) : null;
                if ($leafKey !== null && ! str_starts_with($leafKey, 'v') && ! isset($models[$leafKey])) {
                    $this->addIssue($entry, 'exists_not_visible', 'يوجد تصنيف بهذا المسار في مؤسستك خارج نطاق فرعك؛ لا يمكن إنشاؤه ولا تحديثه من هنا.');
                    continue;
                }
                $entry['target'] = $leafKey;
                $entry['target_is_node'] = $leafKey !== null && isset($models[$leafKey]);
                $existing = $leafKey !== null ? ($models[$leafKey] ?? false) : null;
            }

            $label = $this->pathLabel($entry['segments'], $entry['leaf']);
            if ($existing === null) {
                $this->classifyMissing($entry, $options, 'تصنيف');
                if ($entry['messages'] !== []) {
                    continue;
                }
                $entry['payload'] = $this->categoryCreatePayload($entry);
                $entry['action'] = 'create';
                // يُسجَّل في الشجرة الافتراضية ما سيُنشأ (الآباء الناقصون ثم الورقة) ليراه الصف اللاحق.
                $cursor = $walkCursor;
                $base = count($entry['segments']) - count($pending);
                foreach ($pending as $offset => $segment) {
                    $children[$cursor][$segment] = 'v'.(++$virtual);
                    $entry['creates_parents'][] = implode(' > ', array_slice($entry['segments'], 0, $base + $offset + 1));
                    $cursor = $children[$cursor][$segment];
                    $implicit++;
                }
                $children[$cursor][$entry['leaf']] = 'v'.(++$virtual);
                continue;
            }

            if ($existing === false) {
                // عقدة افتراضية أنشأها صفٌّ سابق في هذه النافذة (أبٌ ضمني): لا نموذج بعد، فالمقارنة بالافتراضات.
                $existing = new ProductCategory(['name' => $entry['leaf'], 'description' => null, 'color' => null, 'is_active' => true]);
                $existing->syncOriginal();
                $entry['target_is_node'] = false;
            }
            $this->classifyExisting($entry, $options, $existing, 'التصنيف «'.$label.'»');
        }
        unset($entry);

        return $implicit;
    }

    /**
     * @param  list<string>  $segments
     * @param  array<string, array<string, string>>  $children
     * @param  array<string, ProductCategory>  $models
     * @return array{0: string, 1: list<string>, 2: ?array{0: string, 1: string}} [المؤشر، المستويات الناقصة، المشكلة]
     */
    private function walkParents(array $segments, array $children, array $models, string $policy): array
    {
        $cursor = '';
        foreach ($segments as $position => $segment) {
            $next = $children[$cursor][$segment] ?? null;
            if ($next === null) {
                if ($policy === self::PARENT_CREATE) {
                    return [$cursor, array_slice($segments, $position), null];
                }

                return [$cursor, [], ['parent_not_found', 'التصنيف الأب «'.implode(' > ', array_slice($segments, 0, $position + 1)).'» غير موجود. أضفه في سطرٍ سابق أو اختر إنشاء الآباء الناقصين.']];
            }
            if (! str_starts_with($next, 'v') && ! isset($models[$next])) {
                return [$cursor, [], ['parent_not_visible', 'التصنيف الأب «'.implode(' > ', array_slice($segments, 0, $position + 1)).'» غير متاح في نطاق فرعك.']];
            }
            $cursor = $next;
        }

        return [$cursor, [], null];
    }

    /**
     * @param  array<string, array{parent: string, name: string}>  $info
     * @return list<string>
     */
    private function nodePath(string $id, array $info): array
    {
        $path = [];
        $guard = 0;
        while ($id !== '' && isset($info[$id]) && $guard++ < 64) {
            array_unshift($path, $info[$id]['name']);
            $id = $info[$id]['parent'];
        }

        return $path;
    }

    /** @param array<string, mixed> $entry @return array<string, mixed> */
    private function categoryCreatePayload(array $entry): array
    {
        return [
            'name' => $entry['values']['name'],
            'description' => $entry['values']['description'] ?? null,
            'color' => $entry['values']['color'] ?? null,
            'is_active' => $entry['values']['is_active'] ?? true,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  أحكام مشتركة
    // ═══════════════════════════════════════════════════════════════

    /** @param array<string, mixed> $entry @param array<string, mixed> $options */
    private function classifyMissing(array &$entry, array $options, string $noun): void
    {
        if ($options['mode'] === self::MODE_UPDATE) {
            $this->addIssue($entry, 'update_target_missing', "لا يوجد $noun مطابق؛ لا يمكن التحديث.");

            return;
        }
        if (isset($entry['values']['nebrax_id'])) {
            $this->addIssue($entry, 'nebrax_id_on_create', 'لا يُنشأ عنصر بمعرّف نبراكس مُدخَل؛ احذفه أو استعمله للتحديث.');

            return;
        }
        if (! isset($entry['values']['name'])) {
            $this->addIssue($entry, 'name_required', '«الاسم» مطلوب للإنشاء.');
        }
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  array<string, mixed>  $options
     * @param  ProductCategory|Brand  $existing
     */
    private function classifyExisting(array &$entry, array $options, $existing, string $label): void
    {
        if ($options['mode'] === self::MODE_CREATE) {
            $this->addIssue($entry, 'existing_matches', "يطابق عنصراً موجوداً: $label. اختر «تحديث» أو «دمج» بدل الإنشاء.");

            return;
        }

        $payload = [];
        foreach (Fields::writableKeys($entry['kind']) as $key) {
            if ($key === 'name' || $key === 'parent_path') {
                continue;   // مقفلان على عنصر قائم
            }
            $field = Fields::get($entry['kind'], $key);
            if (isset($entry['values'][$key])) {
                $payload[$key] = $entry['values'][$key];
            } elseif (isset($entry['blank'][$key]) && $options['blank_policy'] === self::BLANK_CLEAR) {
                if ($field['clearable']) {
                    $payload[$key] = null;
                } else {
                    $entry['warnings'][] = "«{$field['label_ar']}» لا يقبل المسح؛ بقيت قيمته الحالية كما هي.";
                }
            }
        }
        $entry['payload'] = $payload;
        $probe = clone $existing;
        $probe->fill($payload);
        $entry['action'] = $probe->getDirty() === [] ? 'skip' : 'update';
    }

    /** @param array<string, mixed> $row */
    private function planCode(array $row): string
    {
        // الهوية مسارٌ لا معرّف: العقدة قد تكون افتراضية في المعاينة وحقيقية عند التنفيذ في قطعةٍ لاحقة.
        $identity = substr(sha1($this->pathKey($row['segments'] ?? [], (string) ($row['leaf'] ?? ($row['values']['name'] ?? '')))), 0, 16);

        return match ($row['action']) {
            'create' => 'c',
            'update' => 'u:'.$identity,
            'skip' => 's:'.$identity,
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
        $name = $row['values']['name'] ?? ($row['leaf'] ?? null) ?: null;

        return [
            'row' => $row['row'], 'action' => $row['action'], 'status' => $row['status'], 'valid' => $row['valid'],
            'name' => $name,
            'path' => ($row['kind'] ?? null) === Fields::KIND_CATEGORY && $name !== null ? $this->pathLabel($row['segments'] ?? [], (string) $name) : null,
            'creates_parents' => $row['creates_parents'] ?? [],
            'messages' => $row['messages'], 'warnings' => $row['warnings'],
        ];
    }

    /** قفل استشاري على المستأجر (PostgreSQL) داخل المعاملة؛ لا أثر على SQLite (كتابته متسلسلة أصلاً). */
    private function lockTenant(): void
    {
        $connection = DB::connection();
        if ($connection->getDriverName() !== 'pgsql') {
            return;
        }
        if ($connection->transactionLevel() < 1) {
            throw new \LogicException('قفل استيراد التصنيفات يتطلب معاملة نشطة.');
        }
        $connection->select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['taxonomy-import:'.app(TenantContext::class)->id()]);
    }
}
