<?php

namespace App\Services;

use App\Models\Stocktake;
use App\Models\StocktakeLine;
use App\Models\User;
use App\Services\Accounting\StocktakeService;
use App\Support\ImportUnitFailureException;
use App\Support\ProductImportValueNormalizer as Normalizer;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Support\StocktakeCountImportFields as Fields;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * استيراد ورقة عدّ إلى جردٍ **مفتوح** — IMP-H7-S1. يكتب `counted_quantity` وحده عبر `StocktakeService::count` (مسار العدّ المباشر نفسه)؛ لا قيد ولا حركة
 * مخزون ولا ترحيل (الفروق ترحّلها `StocktakeService::post` بفعلٍ منفصل، وتبقى حارسة لحركات المخزون منذ الفتح كما هي). لا يضيف صنفاً إلى الورقة.
 *
 *  - **وحدة التنفيذ الورقة كلها** (قاعدة 9): معاملة واحدة ذرّية؛ أي خطأ صف يمنع الكل — لا ورقة نصف معدودة بسبب ملف.
 *  - **قفل صف الجرد** (`lockForUpdate`) قبل التحليل والكتابة، وإعادة فحص «مفتوح» تحته: ترحيلٌ متزامن (يقفل الصف نفسه أولاً) إما يسبقنا فنفشل لأن الجرد
 *    صار مرحّلاً، وإما ينتظرنا فيرى الورقة كاملة. لا عدٌّ يُكتب على جردٍ رُحِّل.
 *  - **سياسة العدّ القائم** `existing_count_policy` (لكل تشغيل، CLAUDE.md قاعدة 6): `error` (الافتراضي — لا يُستبدل عدٌّ قائم بصمت) · `overwrite` · `skip`.
 *    الكمية المساوية للقائمة «بلا تغيير» دائماً (إعادة رفع الملف نفسه آمنة). السطر غير المذكور في الملف يبقى كما هو (لا يُصفَّر).
 *  - **الوصول:** كما يفعل المتحكّم — فرع الجرد ومخزنه ضمن صلاحيات المستخدم، وإلا «غير موجود».
 *  - الرسائل بنص عربي وأرقام صفوف كما في Excel (العناوين صف ١).
 */
class StocktakeCountImportService
{
    public const POLICY_ERROR = 'error';
    public const POLICY_OVERWRITE = 'overwrite';
    public const POLICY_SKIP = 'skip';

    public const MAX_ROWS = 5000;
    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;
    private const PREVIEW_ROW_LIMIT = 200;

    public function __construct(private readonly StocktakeService $stocktakes) {}

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

    /**
     * قالب عدّ **أعمى** لجردٍ بعينه: صفٌّ لكل صنف في ورقته (رمز/باركود/اسم) وعمود عدّ فارغ — لا رصيد نظام فيه ليبقى العدّ مستقلاً عن الدفتر.
     * يخضع لوصول المستخدم نفسه.
     */
    public function template(string $stocktakeId, ?string $userId): string
    {
        $stocktake = $this->loadStocktake($stocktakeId, $userId, requireDraft: false);
        $rows = [];
        foreach ($stocktake->lines()->with('product')->get() as $line) {
            $product = $line->product;
            $rows[] = [(string) $line->product_id, (string) ($product?->sku ?? ''), (string) ($product?->barcode ?? ''), (string) ($product?->name ?? ''), ''];
        }
        usort($rows, static fn (array $a, array $b): int => strcmp($a[1].$a[3], $b[1].$b[3]));

        return SpreadsheetWriter::csv(array_map(static fn (string $key): string => (string) Fields::get($key)['label_ar'], Fields::templateHeaders()), $rows);
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
        $stocktake = $this->loadStocktake($resolved['stocktake_id'], $userId);
        $parsed = $this->parse($file, $resolved, $stocktake, $maxRows);
        $rows = array_slice($parsed['rows'], 0, self::PREVIEW_ROW_LIMIT);

        return [
            'stocktake_id' => $stocktake->id, 'stocktake_number' => $stocktake->number,
            'existing_count_policy' => $resolved['existing_count_policy'], 'mapping' => $parsed['mapping'],
            'total_rows' => $parsed['total_rows'], 'sheet_lines' => $parsed['sheet_lines'],
            'to_write' => $parsed['counters']['write'], 'unchanged_rows' => $parsed['counters']['unchanged'], 'skipped_rows' => $parsed['counters']['skip'],
            'overwrite_rows' => $parsed['counters']['overwrite'], 'error_rows' => $parsed['counters']['error'],
            'valid_rows' => $parsed['total_rows'] - $parsed['counters']['error'], 'invalid_rows' => $parsed['counters']['error'],
            'uncounted_after' => $parsed['uncounted_after'],
            'rows' => array_map(fn (array $row): array => $this->rowSummary($row), $rows),
            'rows_shown' => count($rows), 'rows_truncated' => count($parsed['rows']) > count($rows),
            'errors' => $parsed['errors'],
        ];
    }

    /**
     * يكتب كل الأعداد في معاملة واحدة تحت قفل صف الجرد، أو لا شيء.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);

        return DB::transaction(function () use ($file, $resolved, $userId, $maxRows): array {
            // القفل أولاً: `StocktakeService::post` يقفل الصف نفسه، فيتسلسل الترحيل والاستيراد؛ والحالة تُقرأ تحت القفل لا قبله.
            $stocktake = $this->loadStocktake($resolved['stocktake_id'], $userId, lock: true);
            $parsed = $this->parse($file, $resolved, $stocktake, $maxRows, lockLines: true);

            if ($parsed['total_rows'] === 0) {
                throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
            }
            if ($parsed['counters']['error'] > 0) {
                throw new ImportUnitFailureException('لا يمكن تطبيق الاستيراد قبل معالجة الأخطاء الظاهرة في المعاينة.', $this->rowFailures($parsed['rows']));
            }

            $counts = [];
            foreach ($parsed['rows'] as $row) {
                if ($row['action'] === 'write') {
                    $counts[$row['product_id']] = $row['quantity'];
                }
            }
            if ($counts !== []) {
                $this->stocktakes->count($stocktake, $counts);
            }

            return [
                'stocktake_id' => $stocktake->id, 'stocktake_number' => $stocktake->number,
                'existing_count_policy' => $resolved['existing_count_policy'],
                'written' => count($counts), 'overwritten' => $parsed['counters']['overwrite'],
                'unchanged' => $parsed['counters']['unchanged'], 'skipped' => $parsed['counters']['skip'],
                'total_rows' => $parsed['total_rows'], 'uncounted_after' => $parsed['uncounted_after'],
                'results' => array_map(fn (array $row): array => $this->rowSummary($row), $parsed['rows']),
            ];
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  الخيارات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array{stocktake_id: string, existing_count_policy: string, mapping: array<int, string|null>|null}
     */
    public function options(array $options): array
    {
        $id = strtolower(trim((string) ($options['stocktake_id'] ?? '')));
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id) !== 1) {
            throw new RuntimeException('معرّف الجرد مطلوب.');
        }
        $policy = (string) ($options['existing_count_policy'] ?? self::POLICY_ERROR);
        if (! in_array($policy, [self::POLICY_ERROR, self::POLICY_OVERWRITE, self::POLICY_SKIP], true)) {
            throw new RuntimeException('سياسة العدّ القائم غير صالحة.');
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
                    throw new RuntimeException('أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد عدّ الجرد.');
                }
                $mapping[(int) $index] = $key;
            }
        }

        return ['stocktake_id' => $id, 'existing_count_policy' => $policy, 'mapping' => $mapping];
    }

    // ═══════════════════════════════════════════════════════════════
    //  التحليل
    // ═══════════════════════════════════════════════════════════════

    /**
     * يحمّل الجرد بشروط المتحكّم: موجود في المؤسسة، فرعه ومخزنه ضمن وصول المستخدم (وإلا «غير موجود» — لا كشف لوجوده)، ومفتوح.
     */
    private function loadStocktake(string $id, ?string $userId, bool $lock = false, bool $requireDraft = true): Stocktake
    {
        $query = Stocktake::query()->whereKey($id);
        if ($lock) {
            $query->lockForUpdate();
        }
        $stocktake = $query->first();
        // `$userId = null` = مشغّل نظام موثوق (لا مستخدم)؛ المحرّك يمرّر دائماً منشئ التشغيلة. معرّف مستخدم غير موجود/محذوف ⇒ رفض لا تجاوز.
        $user = $userId !== null ? User::query()->find($userId) : null;
        $denied = $userId !== null && ($user === null
            // كمتحكّم العدّ: الجرد بلا فرع (`branch_id` فارغ) لا يُفحص فرعه، ويُفحص مخزنه دائماً.
            || ($stocktake !== null && (($stocktake->branch_id !== null && ! $user->canAccessBranch($stocktake->branch_id)) || ! $user->canAccessWarehouse($stocktake->warehouse_id))));

        if ($stocktake === null || $denied) {
            throw new RuntimeException('الجرد غير موجود.');
        }
        if ($requireDraft && ! $stocktake->isDraft()) {
            throw new RuntimeException('الجرد مرحَّل ولا يقبل عدّاً جديداً.');
        }

        return $stocktake;
    }

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
     * @param  array{stocktake_id: string, existing_count_policy: string, mapping: array<int, string|null>|null}  $options
     * @return array<string, mixed>
     */
    private function parse(UploadedFile $file, array $options, Stocktake $stocktake, int $maxRows, bool $lockLines = false): array
    {
        $raw = $this->readFile($file, $maxRows);
        if ($raw === []) {
            throw new RuntimeException('الملف فارغ.');
        }
        $headers = array_map('strval', $raw[0]);
        $mapping = $options['mapping'] ?? Fields::autoMap($headers);
        $this->assertMapping($mapping);

        /** @var array<string, StocktakeLine> $lines بمعرّف المنتج */
        $lines = [];
        $bySku = $byBarcode = [];
        // تحت القفل: أسطر الجرد تُقفل بترتيب المنتج الثابت، فلا يتسلّل عدٌّ مباشر بين قراءة سياسة «العدّ القائم» وكتابتها.
        foreach ($stocktake->lines()->with('product')->orderBy('product_id')->when($lockLines, fn ($q) => $q->lockForUpdate())->get() as $line) {
            $lines[$line->product_id] = $line;
            if (($sku = trim((string) ($line->product?->sku ?? ''))) !== '') {
                $bySku[$sku][] = $line->product_id;
            }
            if (($barcode = trim((string) ($line->product?->barcode ?? ''))) !== '') {
                $byBarcode[$barcode][] = $line->product_id;
            }
        }

        $entries = [];
        $seen = [];
        foreach (array_slice($raw, 1, null, true) as $sheetIndex => $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $entry = ['row' => $sheetIndex + 1, 'ordinal' => count($entries), 'messages' => [], 'product_id' => null, 'quantity' => null, 'action' => 'error', 'sku' => null, 'barcode' => null, 'name' => null, 'current' => null];
            if (count($values) > count($headers)) {
                $entry['messages'][] = 'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.';
            }

            $cells = [];
            foreach ($mapping as $index => $key) {
                if ($key !== null) {
                    $cells[$key] = trim((string) ($values[$index] ?? ''));
                }
            }
            $entry['sku'] = ($cells['sku'] ?? '') !== '' ? $cells['sku'] : null;
            $entry['barcode'] = ($cells['barcode'] ?? '') !== '' ? $cells['barcode'] : null;
            $entry['name'] = ($cells['product_name'] ?? '') !== '' ? $cells['product_name'] : null;

            $line = $this->resolveLine($cells, $lines, $bySku, $byBarcode, $entry['messages']);
            $entry['quantity'] = $this->quantity($cells['counted_quantity'] ?? '', $entry['messages']);

            if ($line !== null) {
                $entry['product_id'] = $line->product_id;
                $entry['name'] ??= $line->product?->name;
                $entry['current'] = $line->counted_quantity;
                $seen[$line->product_id][] = $entry['ordinal'];
            }
            $entries[] = $entry;
        }
        // الصنف نفسه مرتين = خطأ في الصفّين: أيّهما الصحيح قرار صاحب الملف لا تخمين النظام.
        foreach ($seen as $ordinals) {
            if (count($ordinals) > 1) {
                foreach ($ordinals as $ordinal) {
                    $others = implode('، ', array_map(fn (int $o): string => (string) $entries[$o]['row'], array_values(array_diff($ordinals, [$ordinal]))));
                    $entries[$ordinal]['messages'][] = "الصنف مكرّر في الملف (الصفوف: {$others}). اترك صفاً واحداً.";
                }
            }
        }

        $counters = ['write' => 0, 'unchanged' => 0, 'skip' => 0, 'overwrite' => 0, 'error' => 0];
        $errors = [];
        $writtenProducts = [];
        foreach ($entries as &$entry) {
            if ($entry['messages'] === []) {
                $this->decide($entry, $options['existing_count_policy']);
            }
            if ($entry['messages'] !== []) {
                $entry['action'] = 'error';
                $counters['error']++;
                $errors[] = ['row' => $entry['row'], 'messages' => array_values(array_unique($entry['messages']))];
            } else {
                $counters[$entry['action']]++;
                if ($entry['action'] === 'write') {
                    $writtenProducts[$entry['product_id']] = true;
                    if ($entry['current'] !== null) {
                        $counters['overwrite']++;
                    }
                }
            }
            $entry['valid'] = $entry['messages'] === [];
            $entry['status'] = $entry['valid'] ? 'ok' : 'error';
        }
        unset($entry);

        $uncounted = 0;
        foreach ($lines as $productId => $line) {
            if ($line->counted_quantity === null && ! isset($writtenProducts[$productId])) {
                $uncounted++;
            }
        }

        return ['rows' => $entries, 'total_rows' => count($entries), 'sheet_lines' => count($lines), 'mapping' => $mapping, 'counters' => $counters, 'errors' => $errors, 'uncounted_after' => $uncounted];
    }

    /**
     * @param  array<string, mixed>  $entry
     */
    private function decide(array &$entry, string $policy): void
    {
        $current = $entry['current'];
        if ($current === null) {
            $entry['action'] = 'write';

            return;
        }
        if ($current === $entry['quantity']) {
            $entry['action'] = 'unchanged';

            return;
        }
        if ($policy === self::POLICY_SKIP) {
            $entry['action'] = 'skip';
        } elseif ($policy === self::POLICY_OVERWRITE) {
            $entry['action'] = 'write';
        } else {
            $entry['messages'][] = "للصنف عدٌّ قائم ({$current}) يخالف {$entry['quantity']}. اختر «استبدال» أو «تخطّي» للأعداد القائمة، أو صحّح الملف.";
        }
    }

    /**
     * @param  array<string, string>  $cells
     * @param  array<string, StocktakeLine>  $lines
     * @param  array<string, list<string>>  $bySku
     * @param  array<string, list<string>>  $byBarcode
     * @param  list<string>  $messages
     */
    private function resolveLine(array $cells, array $lines, array $bySku, array $byBarcode, array &$messages): ?StocktakeLine
    {
        // كل معرّف مذكور يُحلّ مستقلاً إلى مجموعة أسطر؛ المعرّفات المتعددة يجب أن تتقاطع في سطر واحد (لا يفوز أحدها صامتاً على الآخر).
        $sets = [];
        $id = strtolower($this->unquote($cells['nebrax_id'] ?? ''));
        if ($id !== '') {
            if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id) !== 1) {
                $messages[] = 'معرّف نبراكس غير صالح. احذف العمود لتتم المطابقة برمز الصنف.';

                return null;
            }
            if (! isset($lines[$id])) {
                $messages[] = 'الصنف ليس في ورقة هذا الجرد. الاستيراد لا يضيف أصنافاً إلى الورقة.';

                return null;
            }
            $sets['معرّف نبراكس'] = [$id];
        }
        foreach ([['sku', $bySku, 'الرمز'], ['barcode', $byBarcode, 'الباركود']] as [$field, $index, $label]) {
            $value = $this->unquote($cells[$field] ?? '');
            if ($value === '') {
                continue;
            }
            $matches = $index[$value] ?? [];
            if ($matches === []) {
                $messages[] = "لا صنف بـ{$label} «{$value}» في ورقة هذا الجرد. الاستيراد لا يضيف أصنافاً إلى الورقة.";

                return null;
            }
            $sets[$label] = $matches;
        }

        if ($sets === []) {
            $messages[] = 'الصف بلا معرّف صنف. أضف رمز الصنف أو الباركود أو معرّف نبراكس.';

            return null;
        }
        $common = array_values(array_intersect(...array_values($sets)));
        if ($common === []) {
            $messages[] = 'معرّفات الصف متعارضة: تشير إلى أصناف مختلفة ('.implode('، ', array_keys($sets)).'). صحّح الصف أو احذف الأعمدة الزائدة.';

            return null;
        }
        if (count($common) > 1) {
            $messages[] = 'المعرّف يطابق أكثر من صنف في ورقة الجرد. استخدم معرّف نبراكس.';

            return null;
        }

        return $lines[$common[0]];
    }

    /**
     * التصدير يسبق الخلايا التي تبدأ بـ `= + - @` بفاصلة عليا منعاً لحقن الصيغ في Excel، والقارئ لا يزيلها: نزيلها هنا حتى يعمل ملف round-trip
     * لرمز/باركود مثل `-123`. لا أثر على قيمة لا تبدأ بها.
     */
    private function unquote(string $value): string
    {
        $value = trim($value);

        return preg_match("/^'[=+\\-@\t\r]/", $value) === 1 ? substr($value, 1) : $value;
    }

    /**
     * عدد صحيح غير سالب فقط (أرقام عربية/هندية مقبولة، وفواصل الآلاف). **الفراغ خطأ**: الصف الفارغ يعني «لم يُعدّ» وهو غير الصفر؛ يُحذف الصف من الملف بدل
     * تركه فارغاً، فلا يتحوّل بند منسيّ إلى عجز كامل. الكسور مرفوضة (الكمية صحيحة كما في الجرد).
     *
     * @param  list<string>  $messages
     */
    private function quantity(string $text, array &$messages): ?int
    {
        $digits = Normalizer::digits(trim($text));
        // الفاصلة/المسافة مقبولتان **فاصل آلاف صارماً** فقط (1,000 · 12 500)؛ `1,5` أو `12,5` كانتا ستصيران 15 و125 — عشريّ بفاصلة يضخّم العدّ عشرة أضعاف.
        if (preg_match('/^\d{1,3}(?:[,\x{00A0} ]\d{3})+$/u', $digits) === 1) {
            $digits = preg_replace('/[,\x{00A0} ]/u', '', $digits) ?? $digits;
        }
        if ($digits === '') {
            $messages[] = '«الكمية المعدودة» فارغة. احذف الصف إن لم يُعدّ الصنف — الفراغ لا يعني صفراً.';

            return null;
        }
        if (preg_match('/^\d{1,9}$/', $digits) !== 1) {
            $messages[] = '«الكمية المعدودة» يجب أن تكون عدداً صحيحاً غير سالب بلا كسور (فاصل الآلاف المقبول: 1,000).';

            return null;
        }
        $value = (int) $digits;
        if ($value > Fields::MAX_QUANTITY) {
            $messages[] = '«الكمية المعدودة» تتجاوز الحد المسموح ('.number_format(Fields::MAX_QUANTITY).').';

            return null;
        }

        return $value;
    }

    /** @param array<int, string|null> $mapping */
    private function assertMapping(array $mapping): void
    {
        $chosen = array_values(array_filter($mapping, static fn ($key): bool => $key !== null));
        if (count($chosen) !== count(array_unique($chosen))) {
            throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
        }
        if (array_intersect(Fields::PRODUCT_IDENTIFIERS, $chosen) === []) {
            throw new RuntimeException('الملف يحتاج عمود تعريف للصنف: رمز الصنف أو الباركود أو معرّف نبراكس.');
        }
        if (! in_array('counted_quantity', $chosen, true)) {
            throw new RuntimeException('الاستيراد يحتاج عمود «'.Fields::get('counted_quantity')['label_ar'].'».');
        }
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
            'quantity' => $row['quantity'], 'current_count' => $row['current'],
            'messages' => $row['messages'],
        ];
    }
}
