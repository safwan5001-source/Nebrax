<?php

namespace App\Services;

use App\Models\Partner;
use App\Services\Accounting\PartnerService;
use App\Support\ImportPlanDriftException;
use App\Support\ImportUnitFailureException;
use App\Support\PartnerImportFields as Fields;
use App\Support\ProductImportValueNormalizer as Normalizer;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * استيراد الأطراف (عملاء/موردون) — IMP-H3-S1. يحلّل الملف ويطابق ويعاين ويكتب **صفاً صفاً** عبر الخدمات القانونية؛ لا يتجاوز مسار إنشاء الطرف
 * (`PartnerService::create`) ولا يلمس الأستاذ: **لا رصيد افتتاحي هنا أبداً** (قرار المالك D-01) ولا `opening_balance*` في عقد الحقول.
 *
 *  - **النوع يحدّده مدخل الاستيراد** (`type` = customer|supplier) ولا يُقرأ من الملف ولا يتغيّر لطرف قائم. طرفٌ قائمٌ من النوع الآخر (ليس `both`) خطأ صف، لا تحويل.
 *  - **المطابقة** بمعرّف نبراكس ثم الكود، والاسم ليس معرّفاً أبداً. الاستعلام يمرّ بنطاق المستأجر والفرع، فطرفٌ لا يراه المستخدم لا يُحلّ ولا يُوصف؛
 *    لكن الكود فريدٌ على المستأجر كله، فكودٌ يملكه طرفٌ في فرعٍ آخر يُرفض صراحةً (`code_taken`) بدل أن ينفجر القيد الفريد في منتصف المعاملة.
 *  - **إشارات التكرار** (الرقم الضريبي، السجل، الهاتف، الجوال، البريد) سياسة لكل تشغيلة: `error` | `skip` | `warn` (الافتراضي `warn` = السلوك الحالي
 *    لـ`POST /partners` الذي يقبل التكرار). تُقارَن مطبَّعةً بالتساوي التام مع المخزَّن وبين صفوف الملف نفسه.
 *  - **التزامن:** بسياسة `error`/`skip` تُنفَّذ المطابقة والكتابة تحت قفل استشاري على المستأجر (PostgreSQL) داخل معاملة القطعة، فاستيرادان متزامنان لا يُنشئان
 *    الإشارة نفسها مرتين. مسار `POST /partners` المباشر بلا قفل (يقبل التكرار أصلاً) فسباقه مع الاستيراد مقبولٌ كما هو.
 *  - وحدة التنفيذ الصفّ؛ النافذة (`batch_offset`/`batch_size`) تُحسب على صفوف البيانات الفعلية (بلا العناوين ولا الفارغة).
 */
class PartnerImportService
{
    public const MODE_CREATE = 'create';
    public const MODE_UPDATE = 'update';
    public const MODE_UPSERT = 'upsert';

    public const BLANK_IGNORE = 'ignore';
    public const BLANK_CLEAR = 'clear';

    public const SIGNAL_ERROR = 'error';
    public const SIGNAL_SKIP = 'skip';
    public const SIGNAL_WARN = 'warn';

    public const TYPES = ['customer', 'supplier'];

    public const MAX_ROWS = 2000;
    public const DURABLE_MAX_ROWS = ProductImportService::DURABLE_MAX_ROWS;
    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;
    private const PREVIEW_ROW_LIMIT = 200;
    private const LOOKUP_CHUNK = 400;

    /** رموز خطأ الخلية → رسالتها. */
    private const CELL_ERRORS = [
        'too_long' => 'القيمة تتجاوز الحد المسموح.',
        'invalid_email' => 'البريد الإلكتروني غير صالح.',
        'invalid_vat' => 'الرقم الضريبي يجب أن يكون 15 رقماً.',
        'invalid_money' => 'المبلغ يجب أن يكون رقماً غير سالب بمنزلتين عشريتين على الأكثر.',
        'money_out_of_range' => 'المبلغ يتجاوز النطاق المالي الآمن.',
        'invalid_integer' => 'القيمة يجب أن تكون عدداً صحيحاً.',
        'integer_out_of_range' => 'القيمة خارج النطاق المسموح.',
        'invalid_boolean' => 'القيمة تقبل نعم/لا أو 1/0 أو true/false.',
        'invalid_enum' => 'نوع الكيان يقبل فرد (individual) أو تجاري (commercial).',
        'invalid_nebrax_id' => 'معرّف نبراكس غير صالح.',
    ];

    private const ENTITY_ALIASES = [
        'فرد' => 'individual', 'افراد' => 'individual', 'أفراد' => 'individual', 'شخص' => 'individual', 'individual' => 'individual', 'person' => 'individual',
        'تجاري' => 'commercial', 'شركة' => 'commercial', 'مؤسسة' => 'commercial', 'commercial' => 'commercial', 'company' => 'commercial', 'business' => 'commercial',
    ];

    // ═══════════════════════════════════════════════════════════════
    //  العقد والقالب والفحص
    // ═══════════════════════════════════════════════════════════════

    /** @return list<array<string, mixed>> */
    public function fieldContract(): array
    {
        $contract = [];
        foreach (Fields::all() as $key => $field) {
            $contract[] = [
                'key' => $key, 'label_ar' => $field['label_ar'], 'label_en' => $field['label_en'], 'type' => $field['type'],
                'required' => (bool) $field['required'], 'clearable' => (bool) $field['clearable'],
                'update_locked' => (bool) $field['update_locked'], 'writable' => (bool) $field['writable'],
            ];
        }

        return $contract;
    }

    public function template(string $type): string
    {
        $this->assertType($type);
        $headers = Fields::templateHeaders();
        $example = static fn (array $values): array => array_map(static fn (string $key): string => $values[$key] ?? '', Fields::keys());

        return SpreadsheetWriter::csv($headers, [
            $example(['code' => 'C-1001', 'name' => 'شركة المثال', 'entity_type' => 'commercial', 'vat_number' => '300000000000003', 'email' => 'info@example.com', 'mobile' => '0500000000', 'city' => 'الدمام', 'credit_limit' => '5000.00', 'credit_period' => '30', 'is_active' => 'نعم']),
            $example(['name' => 'محمد أحمد', 'entity_type' => 'individual', 'mobile' => '0555555555']),
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
     * المعاينة مع خطّتها (لرمز كل صف ما سيُنفَّذ فعلاً — يُقارَن وقت التنفيذ ضد `plan_drift` كالمنتجات).
     *
     * @param  array<string, mixed>  $options
     * @return array{preview: array<string, mixed>, plan: array<int, string>|null}
     */
    public function previewWithPlan(UploadedFile $file, array $options, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);
        $parsed = $this->parse($file, $resolved, $maxRows);
        $rows = array_slice($parsed['rows'], 0, self::PREVIEW_ROW_LIMIT);

        $preview = [
            'type' => $resolved['type'], 'mode' => $resolved['mode'], 'blank_policy' => $resolved['blank_policy'],
            'duplicate_signal_policy' => $resolved['duplicate_signal_policy'], 'mapping' => $parsed['mapping'],
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
     * يكتب نافذة الصفوف في معاملة واحدة. الملف **كله** يُحلَّل (للتكرار داخل الملف)، والكتابة لصفوف النافذة وحدها.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId = null, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);

        return DB::transaction(function () use ($file, $resolved, $maxRows): array {
            // القفل قبل المطابقة: ما يراه التحليل هو ما سيُكتب، ولا يمرّ تشغيلٌ متزامن بين الفحص والإدراج.
            if (in_array($resolved['duplicate_signal_policy'], [self::SIGNAL_ERROR, self::SIGNAL_SKIP], true)) {
                $this->lockTenant();
            }
            $parsed = $this->parse($file, $resolved, $maxRows);

            if ($parsed['total_rows'] === 0) {
                throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
            }
            // قبل أي كتابة وفي أول قطعة: تكرارُ داخل الملف في أي موضع يُفشل الملف كله (لا تُرحَّل نوافذ ثم يفشل تكرارٌ متأخر).
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

            $creator = app(PartnerService::class);
            $created = $updated = $skipped = 0;
            $results = [];
            foreach ($parsed['rows'] as $row) {
                if ($row['action'] === 'skip') {
                    $skipped++;
                } elseif ($row['action'] === 'update') {
                    /** @var Partner $existing */
                    $existing = $row['existing'];
                    $existing->update($row['payload']);
                    $updated++;
                } else {
                    $creator->create(['type' => $resolved['type']] + $row['payload']);
                    $created++;
                }
                $results[] = $this->rowSummary($row);
            }

            return [
                'type' => $resolved['type'], 'mode' => $resolved['mode'], 'blank_policy' => $resolved['blank_policy'],
                'duplicate_signal_policy' => $resolved['duplicate_signal_policy'],
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
     * @return array{type: string, mode: string, blank_policy: string, duplicate_signal_policy: string, mapping: array<int, string|null>|null, batch_offset: int, batch_size: ?int, expected_plan: array<int, string>|null}
     */
    public function options(array $options): array
    {
        $type = (string) ($options['type'] ?? '');
        $this->assertType($type);

        $mode = (string) ($options['mode'] ?? self::MODE_CREATE);
        if (! in_array($mode, [self::MODE_CREATE, self::MODE_UPDATE, self::MODE_UPSERT], true)) {
            throw new RuntimeException('وضع الاستيراد غير صالح.');
        }
        $blank = (string) ($options['blank_policy'] ?? self::BLANK_IGNORE);
        if (! in_array($blank, [self::BLANK_IGNORE, self::BLANK_CLEAR], true)) {
            throw new RuntimeException('سياسة القيم الفارغة غير صالحة.');
        }
        $signal = (string) ($options['duplicate_signal_policy'] ?? self::SIGNAL_WARN);
        if (! in_array($signal, [self::SIGNAL_ERROR, self::SIGNAL_SKIP, self::SIGNAL_WARN], true)) {
            throw new RuntimeException('سياسة إشارات التكرار غير صالحة.');
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
                    throw new RuntimeException('أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد الأطراف.');
                }
                $mapping[(int) $index] = $key;
            }
        }

        $offset = max(0, (int) ($options['batch_offset'] ?? 0));
        $size = isset($options['batch_size']) ? max(1, (int) $options['batch_size']) : null;
        $plan = isset($options['expected_plan']) && is_array($options['expected_plan']) ? $options['expected_plan'] : null;

        return [
            'type' => $type, 'mode' => $mode, 'blank_policy' => $blank, 'duplicate_signal_policy' => $signal,
            'mapping' => $mapping, 'batch_offset' => $offset, 'batch_size' => $size, 'expected_plan' => $plan,
        ];
    }

    private function assertType(string $type): void
    {
        if (! in_array($type, self::TYPES, true)) {
            throw new RuntimeException('نوع الاستيراد يجب أن يكون عملاء أو موردين.');
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
     * @param  array<string, mixed>  $options  ناتج `options()`
     * @return array{rows: list<array<string, mixed>>, total_rows: int, mapping: array<int, string|null>, counters: array<string, int>, errors: list<array<string, mixed>>, file_failures: list<array{ordinal: int, code: string, message: string}>}
     */
    private function parse(UploadedFile $file, array $options, int $maxRows): array
    {
        $raw = $this->readFile($file, $maxRows);
        if ($raw === []) {
            throw new RuntimeException('الملف فارغ.');
        }
        $headers = array_map('strval', $raw[0]);
        $mapping = $options['mapping'] ?? Fields::autoMap($headers);
        $this->assertMapping($mapping, $options['mode']);

        // 1) كل الصفوف الفعلية: تطبيعٌ بلا قاعدة بيانات + تتبّع التكرار داخل الملف.
        $entries = [];
        $seen = ['nebrax_id' => [], 'code' => []];
        $seenSignals = [];
        $ordinal = 0;
        foreach (array_slice($raw, 1, null, true) as $sheetIndex => $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $entry = $this->normalizeRow($values, $mapping, $options);
            $entry['row'] = $sheetIndex + 1;
            $entry['ordinal'] = $ordinal++;
            $entry['codes'] = $entry['errors'];
            $entry['messages'] = array_map(fn (string $code): string => $this->message($code), $entry['errors']);
            $entry['warnings'] = [];
            $entry['file_dup'] = false;

            foreach (['nebrax_id', 'code'] as $key) {
                $value = $entry['values'][$key] ?? null;
                if ($value === null) {
                    continue;
                }
                $needle = mb_strtolower((string) $value, 'UTF-8');
                if (isset($seen[$key][$needle])) {
                    $this->addIssue($entry, 'duplicate_in_file', ($key === 'code' ? 'الكود' : 'معرّف نبراكس')." مكرر داخل الملف (أول ظهور في الصف {$seen[$key][$needle]}).");
                    $entry['file_dup'] = true;
                } else {
                    $seen[$key][$needle] = $entry['row'];
                }
            }
            foreach (Fields::DUPLICATE_SIGNALS as $key) {
                $value = $entry['signals'][$key] ?? null;
                if ($value === null) {
                    continue;
                }
                if (isset($seenSignals[$key][$value])) {
                    $this->applySignal($entry, $options['duplicate_signal_policy'], $key, "مكرر داخل الملف (أول ظهور في الصف {$seenSignals[$key][$value]})", true);
                } else {
                    $seenSignals[$key][$value] = $entry['row'];
                }
            }
            $entries[] = $entry;
        }

        $total = count($entries);
        $fileFailures = [];
        foreach ($entries as $entry) {
            if ($entry['file_dup'] || ($entry['file_signal_error'] ?? false)) {
                $fileFailures[] = ['ordinal' => $entry['ordinal'], 'code' => 'row_duplicate_in_file', 'message' => implode(' · ', $entry['messages'])];
            }
        }

        // 2) النافذة وحدها تُطابَق بالقاعدة وتُصنَّف.
        $window = array_slice($entries, $options['batch_offset'], $options['batch_size']);
        $this->match($window, $options);

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
    private function assertMapping(array $mapping, string $mode): void
    {
        $chosen = array_values(array_filter($mapping, static fn ($key): bool => $key !== null));
        if (count($chosen) !== count(array_unique($chosen))) {
            throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
        }
        if (in_array($mode, [self::MODE_CREATE, self::MODE_UPSERT], true) && ! in_array('name', $chosen, true)) {
            throw new RuntimeException('الإنشاء يحتاج عمود «الاسم».');
        }
        if (in_array($mode, [self::MODE_UPDATE, self::MODE_UPSERT], true) && ! in_array('nebrax_id', $chosen, true) && ! in_array('code', $chosen, true)) {
            throw new RuntimeException('التحديث يحتاج عمود معرّف: «معرّف نبراكس» أو «الكود». الاسم لا يصلح معرّفاً.');
        }
    }

    /**
     * @param  array<int, string>  $values
     * @param  array<int, string|null>  $mapping
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private function normalizeRow(array $values, array $mapping, array $options): array
    {
        $present = [];   // قيمٌ مطبَّعة غير فارغة
        $blank = [];     // حقول وردت فارغة
        $errors = [];
        foreach ($mapping as $index => $key) {
            if ($key === null) {
                continue;
            }
            $text = trim((string) ($values[$index] ?? ''));
            if ($text === '') {
                $blank[$key] = true;
                continue;
            }
            [$value, $error] = $this->normalizeCell($key, $text);
            if ($error !== null) {
                $errors[] = $error.':'.$key;
                continue;
            }
            $present[$key] = $value;
        }

        $signals = [];
        foreach (Fields::DUPLICATE_SIGNALS as $key) {
            if (isset($present[$key])) {
                $signals[$key] = $this->signalValue($key, (string) $present[$key]);
            }
        }

        return ['values' => $present, 'blank' => $blank, 'errors' => $errors, 'signals' => $signals, 'existing' => null, 'payload' => []];
    }

    /** @return array{0: mixed, 1: ?string} */
    private function normalizeCell(string $key, string $text): array
    {
        $field = Fields::get($key);
        $max = (int) ($field['max'] ?? 255);

        return match ($field['type']) {
            Fields::TYPE_IDENTIFIER => Str::isUuid($text) ? [mb_strtolower($text, 'UTF-8'), null] : [null, 'invalid_nebrax_id'],
            Fields::TYPE_EMAIL => $this->email($text, $max),
            Fields::TYPE_VAT => $this->vat($text),
            Fields::TYPE_MONEY => Normalizer::money($text),
            Fields::TYPE_INTEGER => Normalizer::integer($text, (int) ($field['min'] ?? 0), (int) ($field['max'] ?? 2147483647)),
            Fields::TYPE_BOOLEAN => Normalizer::boolean($text),
            Fields::TYPE_ENUM => $this->enum($text, (array) $field['values']),
            default => mb_strlen($text) > $max ? [null, 'too_long'] : [$text, null],
        };
    }

    /** @return array{0: ?string, 1: ?string} */
    private function email(string $text, int $max): array
    {
        $value = mb_strtolower($text, 'UTF-8');
        if (mb_strlen($value) > $max) {
            return [null, 'too_long'];
        }

        return filter_var($value, FILTER_VALIDATE_EMAIL) === false ? [null, 'invalid_email'] : [$value, null];
    }

    /** @return array{0: ?string, 1: ?string} */
    private function vat(string $text): array
    {
        $digits = preg_replace('/[\s\-]/u', '', Normalizer::digits($text)) ?? '';

        return preg_match('/^\d{15}$/', $digits) === 1 ? [$digits, null] : [null, 'invalid_vat'];
    }

    /** @param list<string> $values @return array{0: ?string, 1: ?string} */
    private function enum(string $text, array $values): array
    {
        $value = mb_strtolower($text, 'UTF-8');
        $value = self::ENTITY_ALIASES[$value] ?? $value;

        return in_array($value, $values, true) ? [$value, null] : [null, 'invalid_enum'];
    }

    /** مفتاح المقارنة لإشارة تكرار: أرقام فقط للضريبي/السجل/الهاتف/الجوال، والبريد مصغَّراً. */
    private function signalValue(string $key, string $value): ?string
    {
        if ($key === 'email') {
            return mb_strtolower(trim($value), 'UTF-8');
        }
        $digits = preg_replace('/\D+/', '', Normalizer::digits($value)) ?? '';

        return $digits === '' ? null : $digits;
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

    /** @param array<string, mixed> $entry */
    private function applySignal(array &$entry, string $policy, string $key, string $detail, bool $fromFile = false): void
    {
        $label = Fields::get($key)['label_ar'];
        $text = "«{$label}» {$detail}.";
        if ($policy === self::SIGNAL_ERROR) {
            $this->addIssue($entry, 'duplicate_signal', $text);
            if ($fromFile) {
                $entry['file_signal_error'] = true;
            }
        } elseif ($policy === self::SIGNAL_SKIP) {
            $entry['skip_signals'][] = $text;
        } else {
            $entry['warnings'][] = $text;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  المطابقة بقاعدة البيانات
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  list<array<string, mixed>>  $entries  تُعدَّل بالمرجع: `existing`/أخطاء المطابقة/إشارات القاعدة.
     * @param  array<string, mixed>  $options
     */
    private function match(array &$entries, array $options): void
    {
        $ids = $codes = [];
        $signalValues = array_fill_keys(Fields::DUPLICATE_SIGNALS, []);
        foreach ($entries as $entry) {
            if (isset($entry['values']['nebrax_id'])) {
                $ids[$entry['values']['nebrax_id']] = true;
            }
            if (isset($entry['values']['code'])) {
                $codes[(string) $entry['values']['code']] = true;
            }
            foreach ($entry['signals'] as $key => $value) {
                $signalValues[$key][$value] = true;
            }
        }

        $byId = $byCode = [];
        foreach (array_chunk(array_keys($ids), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Partner::query()->whereIn('id', $chunk)->get() as $partner) {
                $byId[mb_strtolower((string) $partner->id, 'UTF-8')] = $partner;
            }
        }
        foreach (array_chunk(array_keys($codes), self::LOOKUP_CHUNK) as $chunk) {
            foreach (Partner::query()->whereIn('code', $chunk)->get() as $partner) {
                $byCode[(string) $partner->code] = $partner;
            }
        }
        // الكود فريد على المستأجر كله (حتى المحذوف حذفاً ناعماً)؛ ما لا يراه المستخدم يُرفض عند الإنشاء بلا وصف.
        $takenElsewhere = [];
        $tenantId = app(TenantContext::class)->id();
        foreach (array_chunk(array_keys($codes), self::LOOKUP_CHUNK) as $chunk) {
            foreach (BranchScope::reference(Partner::class)->withTrashed()->where('tenant_id', $tenantId)->whereIn('code', $chunk)->pluck('code') as $code) {
                $takenElsewhere[(string) $code] = true;
            }
        }
        $holders = $this->signalHolders($signalValues);

        foreach ($entries as &$entry) {
            $existing = null;
            $byIdMatch = isset($entry['values']['nebrax_id']) ? ($byId[$entry['values']['nebrax_id']] ?? null) : null;
            $byCodeMatch = isset($entry['values']['code']) ? ($byCode[(string) $entry['values']['code']] ?? null) : null;

            if (isset($entry['values']['nebrax_id']) && $byIdMatch === null) {
                $this->addIssue($entry, 'target_not_found', 'معرّف نبراكس لا يطابق أي طرف في نطاقك.');
            }
            if ($byIdMatch !== null && $byCodeMatch !== null && (string) $byIdMatch->id !== (string) $byCodeMatch->id) {
                $this->addIssue($entry, 'identifier_conflict', 'معرّف نبراكس والكود يشيران إلى طرفين مختلفين؛ صحّح الصف أو تخطَّه.');
            }
            $existing = $byIdMatch ?? $byCodeMatch;
            $entry['matched_by'] = $byIdMatch !== null ? 'nebrax_id' : ($byCodeMatch !== null ? 'code' : null);

            if ($existing === null && isset($entry['values']['code']) && isset($takenElsewhere[(string) $entry['values']['code']])) {
                $this->addIssue($entry, 'code_taken', 'الكود مستخدم بالفعل لطرف آخر في المؤسسة.');
            }
            if ($existing !== null && ! $this->typeCompatible($existing, $options['type'])) {
                $this->addIssue($entry, 'type_mismatch', 'الطرف المطابق من النوع الآخر؛ لا يغيّر الاستيراد نوع طرف قائم.');
                $existing = null;
            }
            $entry['existing'] = $existing;

            foreach ($entry['signals'] as $key => $value) {
                foreach ($holders[$key][$value] ?? [] as $holderId) {
                    if ($existing === null || (string) $existing->id !== $holderId) {
                        $this->applySignal($entry, $options['duplicate_signal_policy'], $key, 'مستخدم بالفعل لطرف آخر');
                        break;
                    }
                }
            }
        }
        unset($entry);
    }

    private function typeCompatible(Partner $partner, string $type): bool
    {
        return $partner->type === 'both' || $partner->type === $type;
    }

    /**
     * @param  array<string, array<string, true>>  $signalValues
     * @return array<string, array<string, list<string>>> الإشارة → القيمة المطبَّعة → معرّفات الأطراف الحاملة
     */
    private function signalHolders(array $signalValues): array
    {
        $holders = [];
        foreach ($signalValues as $key => $values) {
            if ($values === []) {
                continue;
            }
            foreach (array_chunk(array_keys($values), self::LOOKUP_CHUNK) as $chunk) {
                foreach (Partner::query()->whereIn($key, $chunk)->get(['id', $key]) as $partner) {
                    $normalized = $this->signalValue($key, (string) $partner->{$key});
                    if ($normalized !== null) {
                        $holders[$key][$normalized][] = (string) $partner->id;
                    }
                }
            }
        }

        return $holders;
    }

    // ═══════════════════════════════════════════════════════════════
    //  التصنيف وبناء الحمولة
    // ═══════════════════════════════════════════════════════════════

    /** @param array<string, mixed> $entry @param array<string, mixed> $options */
    private function classify(array &$entry, array $options): string
    {
        if ($entry['messages'] !== []) {
            return 'error';
        }
        $mode = $options['mode'];
        $existing = $entry['existing'];

        if ($existing === null) {
            if ($mode === self::MODE_UPDATE) {
                $this->addIssue($entry, 'update_target_missing', 'لا يوجد طرف مطابق بمعرّف موثوق (معرّف نبراكس أو الكود)؛ لا يمكن التحديث.');

                return 'error';
            }
            if (isset($entry['values']['nebrax_id'])) {
                $this->addIssue($entry, 'nebrax_id_on_create', 'لا يُنشأ طرف بمعرّف نبراكس مُدخَل؛ احذفه أو استعمله للتحديث.');

                return 'error';
            }
            if (! isset($entry['values']['name'])) {
                $this->addIssue($entry, 'name_required', '«الاسم» مطلوب لإنشاء طرف جديد.');

                return 'error';
            }
            if (($entry['skip_signals'] ?? []) !== []) {
                $entry['warnings'] = array_merge($entry['warnings'], $entry['skip_signals']);

                return 'skip';
            }
            $entry['payload'] = $this->createPayload($entry);

            return 'create';
        }

        if ($mode === self::MODE_CREATE) {
            $this->addIssue($entry, 'existing_partner_matches', 'يطابق طرفاً موجوداً: «'.$existing->name.'». اختر «تحديث» أو «دمج» بدل الإنشاء.');

            return 'error';
        }
        if (($entry['skip_signals'] ?? []) !== []) {
            $entry['warnings'] = array_merge($entry['warnings'], $entry['skip_signals']);

            return 'skip';
        }

        $payload = $this->updatePayload($entry, $existing, $options);
        $entry['payload'] = $payload;
        $probe = clone $existing;
        $probe->fill($payload);

        return $probe->getDirty() === [] ? 'skip' : 'update';
    }

    /** @param array<string, mixed> $entry @return array<string, mixed> */
    private function createPayload(array $entry): array
    {
        $payload = [];
        foreach (Fields::writableKeys() as $key) {
            if (isset($entry['values'][$key])) {
                $payload[$key] = $entry['values'][$key];
            }
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private function updatePayload(array &$entry, Partner $existing, array $options): array
    {
        $payload = [];
        foreach (Fields::writableKeys() as $key) {
            $field = Fields::get($key);
            if (isset($entry['values'][$key])) {
                // تغيير الكود مسموح فقط حين تمّت المطابقة بمعرّف نبراكس (وإلا فهو المعرّف نفسه).
                if ($key === 'code' && $entry['matched_by'] !== 'nebrax_id') {
                    continue;
                }
                $payload[$key] = $entry['values'][$key];
            } elseif (isset($entry['blank'][$key]) && $options['blank_policy'] === self::BLANK_CLEAR) {
                if ($field['clearable']) {
                    $payload[$key] = null;
                } else {
                    $entry['warnings'][] = "«{$field['label_ar']}» لا يقبل المسح؛ بقيت قيمته الحالية كما هي.";
                }
            }
        }

        return $payload;
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
        return [
            'row' => $row['row'], 'action' => $row['action'], 'status' => $row['status'], 'valid' => $row['valid'],
            'code' => $row['values']['code'] ?? $row['existing']?->code ?? null,
            'name' => $row['values']['name'] ?? $row['existing']?->name ?? null,
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
            throw new \LogicException('قفل استيراد الأطراف يتطلب معاملة نشطة.');
        }
        $connection->select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['partner-import:'.app(TenantContext::class)->id()]);
    }
}
