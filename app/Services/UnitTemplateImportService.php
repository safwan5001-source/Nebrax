<?php

namespace App\Services;

use App\Models\UnitTemplate;
use App\Models\UnitTemplateUnit;
use App\Support\ImportUnitFailureException;
use App\Support\ProductImportValueNormalizer as Normalizer;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Support\UnitTemplateImportFields as Fields;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * استيراد قوالب الوحدات — IMP-H4-S3. **إنشاء فقط** (قرار المالك D-08: المعامل يضرب الكمية الداخلة إلى المخزون، فلا تعديل ولا مسار ذكاء اصطناعي). يكتب بقواعد
 * `UnitTemplateController::store`/`syncUnits` نفسها؛ لا أثر محاسبي ولا مخزني مباشر، ولا يلمس أي منتج.
 *
 *  - **وحدة التنفيذ الملف كله** (قالبٌ = مجموعة صفوف لا تُجزَّأ، والقوالب قليلة): معاملة واحدة ذرّية؛ أي خطأ يمنع كل شيء.
 *  - **الصيغة طويلة:** صفٌّ لكل وحدة بديلة، يتكرر فيه اسم القالب ووحدة الأساس؛ تعارض وحدة الأساس أو الحالة بين صفوف قالب واحد خطأ على الصف المتعارض.
 *  - **القواعد (حرفياً من المتحكّم):** الاسم فريد على المؤسسة (كل الفروع)، المعامل صحيح 2…1,000,000، لا وحدة بديلة باسم الأساس، لا تكرار وحدة، ≤ 50 وحدة.
 *  - **القالب القائم:** سياسة لكل تشغيل `existing_policy` = `error` (الافتراضي) أو `skip` (يُتخطّى القالب كله بتحذير ولا تُقارَن وحداته ولا تُعدَّل أبداً).
 *  - **التزامن:** التفرّد فحصٌ تطبيقي (لا قيد قاعدة) فيجري التحليل والكتابة بعد قفل استشاري على المستأجر (PostgreSQL) داخل المعاملة.
 */
class UnitTemplateImportService
{
    public const EXISTING_ERROR = 'error';
    public const EXISTING_SKIP = 'skip';

    public const MAX_ROWS = 2000;
    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;
    private const PREVIEW_ROW_LIMIT = 200;

    private const CELL_ERRORS = [
        'too_long' => 'القيمة تتجاوز الحد المسموح.',
        'invalid_integer' => 'المعامل يجب أن يكون عدداً صحيحاً.',
        'integer_out_of_range' => 'المعامل يجب أن يكون بين 2 و1,000,000.',
        'invalid_boolean' => 'القيمة تقبل نعم/لا أو 1/0 أو true/false.',
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
        return SpreadsheetWriter::csv(Fields::templateHeaders(), [
            ['كرتون/قطعة', 'قطعة', 'كرتون', '12', 'نعم'],
            ['كرتون/قطعة', 'قطعة', 'دزينة', '12', ''],
            ['وزن بالكيلو', 'كيلو', 'طن', '1000', ''],
            ['قطعة فقط', 'قطعة', '', '', ''],
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
        $resolved = $this->options($options);
        $parsed = $this->parse($file, $resolved, $maxRows);
        $rows = array_slice($parsed['rows'], 0, self::PREVIEW_ROW_LIMIT);

        return [
            'existing_policy' => $resolved['existing_policy'], 'mapping' => $parsed['mapping'],
            'total_rows' => $parsed['total_rows'], 'template_count' => count($parsed['templates']),
            'create_templates' => $parsed['counters']['create'], 'skipped_templates' => $parsed['counters']['skip'],
            'create_units' => $parsed['counters']['units'], 'warning_rows' => $parsed['counters']['warning'], 'error_rows' => $parsed['counters']['error'],
            'valid_rows' => $parsed['total_rows'] - $parsed['counters']['error'], 'invalid_rows' => $parsed['counters']['error'],
            'rows' => array_map(fn (array $row): array => $this->rowSummary($row), $rows),
            'rows_shown' => count($rows), 'rows_truncated' => count($parsed['rows']) > count($rows),
            'errors' => $parsed['errors'],
        ];
    }

    /**
     * ينشئ كل القوالب في معاملة واحدة، أو لا شيء.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId = null, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);

        return DB::transaction(function () use ($file, $resolved, $maxRows): array {
            $this->lockTenant();
            $parsed = $this->parse($file, $resolved, $maxRows);

            if ($parsed['total_rows'] === 0) {
                throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
            }
            if ($parsed['counters']['error'] > 0) {
                throw new ImportUnitFailureException('لا يمكن تطبيق الاستيراد قبل معالجة الأخطاء الظاهرة في المعاينة.', $this->rowFailures($parsed['rows']));
            }

            $templates = $units = $skipped = 0;
            foreach ($parsed['templates'] as $group) {
                if ($group['action'] === 'skip') {
                    $skipped++;
                    continue;
                }
                $template = UnitTemplate::create(['name' => $group['name'], 'base_unit' => $group['base_unit'], 'is_active' => $group['is_active']]);
                foreach ($group['units'] as $unit) {
                    UnitTemplateUnit::create(['unit_template_id' => $template->id, 'name' => $unit['name'], 'factor' => $unit['factor']]);
                    $units++;
                }
                $templates++;
            }

            return [
                'existing_policy' => $resolved['existing_policy'],
                'created' => $templates, 'created_units' => $units, 'skipped' => $skipped, 'updated' => 0,
                'total_rows' => $parsed['total_rows'],
                'results' => array_map(fn (array $row): array => $this->rowSummary($row), $parsed['rows']),
            ];
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  الخيارات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array{existing_policy: string, mapping: array<int, string|null>|null}
     */
    public function options(array $options): array
    {
        $policy = (string) ($options['existing_policy'] ?? self::EXISTING_ERROR);
        if (! in_array($policy, [self::EXISTING_ERROR, self::EXISTING_SKIP], true)) {
            throw new RuntimeException('سياسة القوالب القائمة غير صالحة.');
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
                    throw new RuntimeException('أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد قوالب الوحدات.');
                }
                $mapping[(int) $index] = $key;
            }
        }

        return ['existing_policy' => $policy, 'mapping' => $mapping];
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
     * @return array{rows: list<array<string, mixed>>, templates: array<string, array<string, mixed>>, total_rows: int, mapping: array<int, string|null>, counters: array<string, int>, errors: list<array<string, mixed>>}
     */
    private function parse(UploadedFile $file, array $options, int $maxRows): array
    {
        $raw = $this->readFile($file, $maxRows);
        if ($raw === []) {
            throw new RuntimeException('الملف فارغ.');
        }
        $headers = array_map('strval', $raw[0]);
        $mapping = $options['mapping'] ?? Fields::autoMap($headers);
        $this->assertMapping($mapping);

        $entries = [];
        foreach (array_slice($raw, 1, null, true) as $sheetIndex => $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $entry = $this->normalizeRow($values, $mapping);
            $entry['row'] = $sheetIndex + 1;
            $entry['ordinal'] = count($entries);
            $entry['messages'] = array_map(fn (string $code): string => $this->message($code), $entry['errors']);
            $entry['warnings'] = [];
            // صفٌّ أعرض من صف العناوين تسقط قيمةٌ منه صامتةً — أخطر من خطأ صريح.
            if (count($values) > count($headers)) {
                $entry['messages'][] = 'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.';
            }
            $entries[] = $entry;
        }

        // القوالب القائمة (المؤسسة كلها — كالمتحكّم) لأسماء الملف فقط.
        $names = array_values(array_unique(array_filter(array_map(static fn (array $entry): ?string => $entry['values']['template_name'] ?? null, $entries), static fn (?string $name): bool => $name !== null)));
        $existing = [];
        foreach (array_chunk($names, 400) as $chunk) {
            foreach (BranchScope::reference(UnitTemplate::class)->whereIn('name', $chunk)->pluck('name') as $name) {
                $existing[(string) $name] = true;
            }
        }

        $templates = [];
        foreach ($entries as &$entry) {
            $this->group($entry, $templates, $existing, $options);
        }
        unset($entry);

        $counters = ['create' => 0, 'skip' => 0, 'units' => 0, 'warning' => 0, 'error' => 0];
        $errors = [];
        foreach ($entries as &$entry) {
            $entry['status'] = $entry['messages'] !== [] ? 'error' : ($entry['warnings'] !== [] ? 'warning' : 'ok');
            $entry['valid'] = $entry['messages'] === [];
            if ($entry['messages'] !== []) {
                $counters['error']++;
                $errors[] = ['row' => $entry['row'], 'messages' => array_values(array_unique($entry['messages']))];
            } elseif ($entry['warnings'] !== []) {
                $counters['warning']++;
            }
        }
        unset($entry);
        foreach ($templates as $group) {
            $group['action'] === 'skip' ? $counters['skip']++ : $counters['create']++;
            $counters['units'] += $group['action'] === 'skip' ? 0 : count($group['units']);
        }
        foreach ($entries as &$entry) {
            $entry['action'] = $entry['messages'] !== [] ? 'error' : ($templates[$entry['values']['template_name']]['action'] ?? 'error');
        }
        unset($entry);

        return ['rows' => $entries, 'templates' => $templates, 'total_rows' => count($entries), 'mapping' => $mapping, 'counters' => $counters, 'errors' => $errors];
    }

    /** @param array<int, string|null> $mapping */
    private function assertMapping(array $mapping): void
    {
        $chosen = array_values(array_filter($mapping, static fn ($key): bool => $key !== null));
        if (count($chosen) !== count(array_unique($chosen))) {
            throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
        }
        foreach (['template_name', 'base_unit'] as $required) {
            if (! in_array($required, $chosen, true)) {
                throw new RuntimeException('الاستيراد يحتاج عمود «'.Fields::get($required)['label_ar'].'».');
            }
        }
        if (in_array('factor', $chosen, true) !== in_array('unit_name', $chosen, true)) {
            throw new RuntimeException('عمودا «الوحدة البديلة» و«المعامل» يُربطان معاً أو يُتركان معاً.');
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

        return ['values' => $present, 'errors' => $errors];
    }

    /** @return array{0: mixed, 1: ?string} */
    private function normalizeCell(string $key, string $text): array
    {
        $field = Fields::get($key);

        return match ($field['type']) {
            Fields::TYPE_INTEGER => $this->factor($text, (int) $field['min'], (int) $field['max']),
            Fields::TYPE_BOOLEAN => Normalizer::boolean($text),
            default => mb_strlen($text) > (int) ($field['max'] ?? 255) ? [null, 'too_long'] : [$text, null],
        };
    }

    /**
     * المعامل يضرب كمية المخزون: **أرقام فقط** بعد تحويل الأرقام العربية، بلا فواصل آلاف ولا فاصلة عشرية ولا `%` ولا أصفار بادئة ولا `.0`
     * (`2,5` كانت ستصير 25 و`1,2` ستصير 12 في معيِّر المنتجات المتسامح). ما يرفضه `integer` في `StoreUnitTemplateRequest` أو يلتبس كعشري يُرفض هنا.
     *
     * @return array{0: ?int, 1: ?string}
     */
    private function factor(string $text, int $min, int $max): array
    {
        $digits = Normalizer::digits(trim($text));
        if (preg_match('/^[1-9]\d{0,9}$/', $digits) !== 1) {
            return [null, 'invalid_integer'];
        }
        $value = (int) $digits;

        return $value < $min || $value > $max ? [null, 'integer_out_of_range'] : [$value, null];
    }

    private function message(string $code): string
    {
        [$base, $field] = array_pad(explode(':', $code, 2), 2, null);
        $label = $field !== null && Fields::get($field) !== null ? '«'.Fields::get($field)['label_ar'].'»: ' : '';

        return $label.(self::CELL_ERRORS[$base] ?? 'قيمة غير صالحة.');
    }

    /**
     * يضمّ الصف إلى قالبه ويفحص اتساق المجموعة. الصف الذي فيه خطأ خلية لا يدخل المجموعة (فلا يُبنى قالبٌ من نصفه) لكن يفشل التشغيل كله.
     *
     * @param  array<string, mixed>  $entry
     * @param  array<string, array<string, mixed>>  $templates
     * @param  array<string, true>  $existing
     * @param  array<string, mixed>  $options
     */
    private function group(array &$entry, array &$templates, array $existing, array $options): void
    {
        $name = $entry['values']['template_name'] ?? null;
        if ($name === null) {
            $entry['messages'][] = '«اسم القالب» مطلوب.';

            return;
        }
        $base = $entry['values']['base_unit'] ?? null;
        if (! isset($templates[$name])) {
            $isExisting = isset($existing[$name]);
            if ($isExisting && $options['existing_policy'] === self::EXISTING_ERROR) {
                $entry['messages'][] = 'يوجد قالب وحدات بهذا الاسم. اختر «تخطّي القوالب القائمة» أو غيّر الاسم (الاستيراد لا يعدّل قالباً قائماً).';
            }
            if ($isExisting && $options['existing_policy'] === self::EXISTING_SKIP) {
                $entry['warnings'][] = 'القالب موجود: يُتخطّى كله ولا تُقارَن وحداته ولا تُعدَّل.';
            }
            $templates[$name] = ['name' => $name, 'base_unit' => $base, 'is_active' => $entry['values']['is_active'] ?? true, 'units' => [], 'action' => $isExisting ? 'skip' : 'create', 'first_row' => $entry['row'], 'seen' => [], 'status_set' => array_key_exists('is_active', $entry['values'])];
        }
        $group = &$templates[$name];

        if ($entry['errors'] !== []) {
            return;
        }
        // قالبٌ قائم يُتخطّى: لا تُفحص وحداته (الرسالة تقول إنها لا تُقارَن) — أخطاء الخلايا وحدها تُفشل الملف.
        if ($group['action'] === 'skip') {
            return;
        }
        if ($group['base_unit'] === null && $base !== null) {
            $group['base_unit'] = $base;
        }
        if ($base === null) {
            $entry['messages'][] = '«وحدة الأساس» مطلوبة في كل صف.';
        } elseif ($base !== $group['base_unit']) {
            $entry['messages'][] = "وحدة الأساس «{$base}» تخالف «{$group['base_unit']}» المذكورة لهذا القالب في الصف {$group['first_row']}.";
        }
        if (array_key_exists('is_active', $entry['values'])) {
            if ($group['status_set'] && (bool) $entry['values']['is_active'] !== (bool) $group['is_active']) {
                $entry['messages'][] = 'حالة القالب (نشط) تخالف المذكورة لهذا القالب في صفٍّ آخر.';
            } elseif (! $group['status_set']) {
                $group['is_active'] = (bool) $entry['values']['is_active'];
                $group['status_set'] = true;
            }
        }

        $unit = $entry['values']['unit_name'] ?? null;
        $factor = $entry['values']['factor'] ?? null;
        if ($unit === null && $factor !== null) {
            $entry['messages'][] = 'المعامل بلا «الوحدة البديلة».';
        } elseif ($unit !== null && $factor === null) {
            $entry['messages'][] = "الوحدة «{$unit}» بلا معامل.";
        } elseif ($unit !== null) {
            if ($unit === $group['base_unit']) {
                $entry['messages'][] = 'لا تُضاف وحدة الأساس ضمن الوحدات البديلة — معاملها ١ ضمناً.';
            } elseif (isset($group['seen'][$unit])) {
                $entry['messages'][] = "الوحدة «{$unit}» مكرّرة في القالب (أول ظهور في الصف {$group['seen'][$unit]}).";
            } elseif (count($group['units']) >= Fields::MAX_UNITS) {
                $entry['messages'][] = 'القالب يتجاوز الحد الأقصى لعدد الوحدات البديلة ('.Fields::MAX_UNITS.').';
            } elseif ($entry['messages'] === []) {
                $group['seen'][$unit] = $entry['row'];
                $group['units'][] = ['name' => $unit, 'factor' => (int) $factor];
            }
        }
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
        return [
            'row' => $row['row'], 'action' => $row['action'], 'status' => $row['status'], 'valid' => $row['valid'],
            'template' => $row['values']['template_name'] ?? null, 'base_unit' => $row['values']['base_unit'] ?? null,
            'unit' => $row['values']['unit_name'] ?? null, 'factor' => $row['values']['factor'] ?? null,
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
            throw new \LogicException('قفل استيراد قوالب الوحدات يتطلب معاملة نشطة.');
        }
        $connection->select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['unit-template-import:'.app(TenantContext::class)->id()]);
    }
}
