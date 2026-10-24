<?php

namespace App\Services;

use App\Models\Account;
use App\Models\CostCenter;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Partner;
use App\Services\Accounting\ExpenseService;
use App\Support\DuplicateDocumentException;
use App\Support\ExpenseImportFields as Fields;
use App\Support\ImportPlanDriftException;
use App\Support\ImportUnitFailureException;
use App\Support\ProductImportValueNormalizer as Normalizer;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchScope;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * استيراد المصروفات — IMP-H5-S1c. يحلّل الملف ويطابق ويعاين ويكتب **صفاً صفاً** عبر `ExpenseService::create` وحده: صفٌّ واحد = **مسودة** مصروف واحدة.
 * لا ترحيل ولا قيد هنا أبداً (الترحيل فعلٌ منفصل عبر المحرك المحاسبي)، والضريبة والإجمالي **مشتقّان** في الخدمة من `amount` و`tax_rate` ولا عمود لهما في عقد الحقول.
 *
 *  - **المراجع بمعرّفات موثوقة:** الحساب بالكود (مصروف، حركي، نشط)، المورّد بكوده (طرف مورّد مرئي)، مركز التكلفة بكوده (نشط)، والتصنيف باسمه المطابَق تماماً بين التصنيفات
 *    النشطة (غموض ⇒ خطأ). **الاسم ليس معرّفاً** لأي كيان غير التصنيف الذي لا كود له. لا إنشاء تلقائي لأي مرجع: غيابه خطأ صف.
 *  - **منع التكرار** (`import_document_reservations`، IMP-H5-S1a/b): كل مصروف مستورد يحجز هويته (مورّد ‖ مرجع ‖ تاريخ ‖ مبلغ). قبل الكتابة يرى المستورد التكرارات
 *    داخل الملف وضد المصروفات القائمة بمعيار الخدمة نفسه (مورّد ‖ تاريخ ‖ مبلغ، بغضّ النظر عن المرجع) ويرفضها صفوف أخطاء. **التكرار الحقيقي المؤكَّد** صراحةً
 *    (`confirmed_repeat_rows` = أرقام صفوف الورقة) يأخذ معرّف تمييزٍ حتميّاً من `occurrence_scope` (معرّف المهمة) ورقم الصف — فإعادة نافذةٍ لا تُنتج مصروفاً ثانياً.
 *  - **التكرار داخل الملف** يُفشل الملف كله في أول قطعة (كما الأطراف) فلا تُرحَّل نوافذ ثم يظهر تكرار متأخر.
 *  - **السياسات لكل تشغيلة** (لا سلوك واحد مفروض): `reference_policy` (optional | required)، `default_account_id`، `default_payment_method`، `default_tax_rate`.
 *  - وحدة التنفيذ الصفّ؛ النافذة (`batch_offset`/`batch_size`) تُحسب على صفوف البيانات الفعلية (بلا العناوين ولا الفارغة).
 */
class ExpenseImportService
{
    public const REFERENCE_OPTIONAL = 'optional';
    public const REFERENCE_REQUIRED = 'required';

    public const MAX_ROWS = 2000;
    public const DURABLE_MAX_ROWS = ProductImportService::DURABLE_MAX_ROWS;
    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;
    private const PREVIEW_ROW_LIMIT = 200;
    private const LOOKUP_CHUNK = 400;
    private const MAX_AMOUNT_MINOR = 100000000000;

    /** رموز خطأ الخلية → رسالتها. */
    private const CELL_ERRORS = [
        'too_long' => 'القيمة تتجاوز الحد المسموح.',
        'invalid_date' => 'التاريخ غير صالح (استخدم YYYY-MM-DD أو DD/MM/YYYY).',
        'invalid_money' => 'المبلغ يجب أن يكون رقماً بمنزلتين عشريتين على الأكثر (الفاصلة العشرية نقطة، والفاصلة للآلاف).',
        'money_out_of_range' => 'المبلغ يتجاوز النطاق المالي الآمن.',
        'amount_not_positive' => 'المبلغ يجب أن يكون أكبر من صفر.',
        'invalid_integer' => 'القيمة يجب أن تكون عدداً صحيحاً.',
        'integer_out_of_range' => 'نسبة الضريبة يجب أن تكون بين 0 و100.',
        'invalid_enum' => 'طريقة الدفع تقبل نقد أو بنك أو آجل (cash / bank / credit).',
    ];

    private const PAYMENT_ALIASES = [
        'نقد' => 'cash', 'نقدي' => 'cash', 'نقدا' => 'cash', 'كاش' => 'cash', 'cash' => 'cash',
        'بنك' => 'bank', 'بنكي' => 'bank', 'تحويل' => 'bank', 'تحويل بنكي' => 'bank', 'bank' => 'bank', 'transfer' => 'bank',
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
            $example(['expense_date' => '2026-10-01', 'amount' => '1000.00', 'account_code' => '5130', 'category' => 'إيجارات', 'vendor_name' => 'شركة العقار', 'payment_method' => 'bank', 'tax_rate' => '15', 'reference' => 'INV-2041', 'description' => 'إيجار أكتوبر']),
            $example(['expense_date' => '2026-10-02', 'amount' => '85.50', 'account_code' => '5130', 'vendor_name' => 'مطعم المثال', 'payment_method' => 'cash', 'tax_rate' => '15']),
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
     * المعاينة مع خطّتها (لرمز كل صف ما سيُنفَّذ فعلاً — يُقارَن وقت التنفيذ ضد `plan_drift` كالمنتجات والأطراف).
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
            'reference_policy' => $resolved['reference_policy'], 'default_account_id' => $resolved['default_account_id'],
            'default_payment_method' => $resolved['default_payment_method'], 'default_tax_rate' => $resolved['default_tax_rate'],
            'confirmed_repeat_rows' => $resolved['confirmed_repeat_rows'], 'mapping' => $parsed['mapping'],
            'total_rows' => $parsed['total_rows'], 'create_rows' => $parsed['counters']['create'], 'warning_rows' => $parsed['counters']['warning'],
            'error_rows' => $parsed['counters']['error'], 'valid_rows' => $parsed['total_rows'] - $parsed['counters']['error'], 'invalid_rows' => $parsed['counters']['error'],
            'create_amount_minor' => $parsed['create_amount_minor'],
            'rows' => array_map(fn (array $row): array => $this->rowSummary($row), $rows),
            'rows_shown' => count($rows), 'rows_truncated' => count($parsed['rows']) > count($rows),
            // كل صفٍّ مكرَّر المرشَّح أو المؤكَّد (مقيَّد بالسقف) مهما كان موضعه: قائمة المعاينة مقتطعة عند 200 صف فلا يجوز أن يغيب خيار التأكيد عن صفٍّ بعده.
            'repeat_candidates' => array_map(fn (array $row): array => $this->rowSummary($row), array_slice(array_values(array_filter(
                $parsed['rows'], static fn (array $row): bool => $row['confirmed'] || array_intersect(['duplicate_in_file', 'existing_expense_matches'], $row['codes'] ?? []) !== [],
            )), 0, self::PREVIEW_ROW_LIMIT)),
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
     * يكتب نافذة الصفوف مسوداتٍ في معاملة واحدة. الملف **كله** يُحلَّل (للتكرار داخل الملف)، والكتابة لصفوف النافذة وحدها.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId = null, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);

        return DB::transaction(function () use ($file, $resolved, $userId, $maxRows): array {
            $parsed = $this->parse($file, $resolved, $maxRows);

            if ($parsed['total_rows'] === 0) {
                throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
            }
            // قبل أي كتابة وفي أول قطعة: تكرار غير مؤكَّد داخل الملف في أي موضع يُفشل الملف كله (لا تُرحَّل نوافذ ثم يفشل تكرارٌ متأخر).
            if ($resolved['batch_offset'] === 0 && $parsed['file_failures'] !== []) {
                throw new ImportUnitFailureException('لا يمكن تطبيق الاستيراد: تكرار داخل الملف.', $parsed['file_failures']);
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

            if ($parsed['counters']['error'] > 0) {
                throw new ImportUnitFailureException('لا يمكن تطبيق الاستيراد قبل معالجة الأخطاء الظاهرة في المعاينة.', $this->rowFailures($parsed['rows']));
            }

            $expenses = app(ExpenseService::class);
            $created = 0;
            $results = [];
            $failures = [];
            foreach ($parsed['rows'] as $row) {
                try {
                    // نقطة حفظ لكل صف: تنازعٌ متزامن يُرمى بعد أن تكون معاملة PostgreSQL ما زالت صالحة، ثم تتراجع القطعة كلها بفشل صفّه المسمّى.
                    DB::transaction(fn () => $expenses->create(
                        $row['payload'] + ['created_by' => $userId],
                        ['source' => DocumentDuplicateReservationService::SOURCE_STANDARD, 'reference' => $row['reference'], 'occurrence_id' => $row['occurrence']],
                    ));
                    $created++;
                } catch (DuplicateDocumentException) {
                    $failures[] = ['ordinal' => (int) $row['ordinal'], 'code' => 'duplicate_document', 'message' => 'مصروف مطابق (المورّد والتاريخ والمبلغ) أُنشئ للتو من مسار آخر.'];
                }
                $results[] = $this->rowSummary($row);
            }
            if ($failures !== []) {
                throw new ImportUnitFailureException('تعذّر إنشاء بعض الصفوف: مصروف مطابق أُنشئ للتو.', $failures);
            }

            return [
                'created' => $created, 'updated' => 0, 'skipped' => 0,
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
     * @return array{reference_policy: string, default_account_id: ?string, default_payment_method: string, default_tax_rate: int, confirmed_repeat_rows: list<int>, occurrence_scope: string, mapping: array<int, string|null>|null, batch_offset: int, batch_size: ?int, expected_plan: array<int, string>|null}
     */
    public function options(array $options): array
    {
        foreach (['reference_policy', 'default_account_id', 'default_payment_method', 'occurrence_scope'] as $scalar) {
            if (isset($options[$scalar]) && ! is_scalar($options[$scalar])) {
                throw new RuntimeException('خيار استيراد المصروفات غير صالح.');
            }
        }
        $reference = (string) ($options['reference_policy'] ?? self::REFERENCE_OPTIONAL);
        if (! in_array($reference, [self::REFERENCE_OPTIONAL, self::REFERENCE_REQUIRED], true)) {
            throw new RuntimeException('سياسة رقم المرجع غير صالحة.');
        }
        $defaultAccount = isset($options['default_account_id']) && $options['default_account_id'] !== '' ? mb_strtolower((string) $options['default_account_id'], 'UTF-8') : null;
        if ($defaultAccount !== null && ! Str::isUuid($defaultAccount)) {
            throw new RuntimeException('حساب المصروف الافتراضي غير صالح.');
        }
        $payment = (string) ($options['default_payment_method'] ?? 'cash');
        if (! in_array($payment, Fields::PAYMENT_METHODS, true)) {
            throw new RuntimeException('طريقة الدفع الافتراضية غير صالحة.');
        }
        $tax = $options['default_tax_rate'] ?? 15;
        if (! is_numeric($tax) || (int) $tax != $tax || (int) $tax < 0 || (int) $tax > 100) {
            throw new RuntimeException('نسبة الضريبة الافتراضية يجب أن تكون عدداً صحيحاً بين 0 و100.');
        }

        $repeats = [];
        foreach ((array) ($options['confirmed_repeat_rows'] ?? []) as $row) {
            if (! is_numeric($row) || (int) $row != $row || (int) $row < 2) {
                throw new RuntimeException('أرقام صفوف التكرار المؤكَّد يجب أن تكون أرقام صفوف صالحة من الورقة.');
            }
            $repeats[(int) $row] = (int) $row;
        }
        ksort($repeats);
        if (count($repeats) > self::MAX_ROWS) {
            throw new RuntimeException('عدد صفوف التكرار المؤكَّد يتجاوز الحد.');
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
                    throw new RuntimeException('أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد المصروفات.');
                }
                $mapping[(int) $index] = $key;
            }
        }

        $plan = isset($options['expected_plan']) && is_array($options['expected_plan']) ? $options['expected_plan'] : null;

        return [
            'reference_policy' => $reference, 'default_account_id' => $defaultAccount, 'default_payment_method' => $payment, 'default_tax_rate' => (int) $tax,
            'confirmed_repeat_rows' => array_values($repeats), 'occurrence_scope' => mb_substr((string) ($options['occurrence_scope'] ?? 'standalone'), 0, 64),
            'mapping' => $mapping, 'batch_offset' => max(0, (int) ($options['batch_offset'] ?? 0)),
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
     * @return array{rows: list<array<string, mixed>>, total_rows: int, mapping: array<int, string|null>, counters: array<string, int>, errors: list<array<string, mixed>>, file_failures: list<array{ordinal: int, code: string, message: string}>, create_amount_minor: int}
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
            $entry['confirmed'] = in_array($entry['row'], $options['confirmed_repeat_rows'], true);
            // صفٌّ أعرض من صف العناوين تسقط قيمةٌ منه صامتةً (فاصلة غير مقتبَسة في الوصف مثلاً) — أخطر من خطأ صريح.
            if (count($values) > count($headers)) {
                $this->addIssue($entry, 'row_wider_than_header', 'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.');
            }
            $entries[] = $entry;
        }

        // 2) المراجع (حساب/مورّد/مركز/تصنيف) لكل الملف بدفعات: لازمة لمفتاح التكرار داخل الملف.
        $this->resolveReferences($entries, $options);

        // 3) التكرار داخل الملف: نفس معيار الخدمة (مورّد ‖ تاريخ ‖ مبلغ). غير المؤكَّد يُفشل الملف كله.
        $fileFailures = [];
        $seen = [];
        foreach ($entries as &$entry) {
            $entry['identity'] = null;
            if (isset($entry['values']['expense_date'], $entry['values']['amount'])) {
                $entry['identity'] = DocumentDuplicateReservationService::vendorKey($entry['refs']['partner_id'] ?? null, $entry['values']['vendor_name'] ?? null)
                    .'|'.$entry['values']['expense_date'].'|'.$entry['values']['amount'];
                if (isset($seen[$entry['identity']])) {
                    $entry['repeat_in_file'] = $seen[$entry['identity']];
                    if (! $entry['confirmed']) {
                        $this->addIssue($entry, 'duplicate_in_file', "مصروف مطابق (المورّد والتاريخ والمبلغ) سبق في الصف {$seen[$entry['identity']]}. إن كان تكراراً حقيقياً فأكّده صراحةً.");
                        $fileFailures[] = ['ordinal' => $entry['ordinal'], 'code' => 'row_duplicate_in_file', 'message' => implode(' · ', $entry['messages'])];
                    }
                } else {
                    $seen[$entry['identity']] = $entry['row'];
                }
            }
        }
        unset($entry);

        $total = count($entries);

        // 4) النافذة وحدها تُقارَن بالمصروفات القائمة وتُصنَّف.
        $window = array_slice($entries, $options['batch_offset'], $options['batch_size']);
        $this->matchExisting($window);

        $counters = ['create' => 0, 'warning' => 0, 'error' => 0];
        $errors = [];
        $createAmount = 0;
        foreach ($window as &$entry) {
            $entry['action'] = $this->classify($entry, $options);
            $entry['status'] = $entry['messages'] !== [] ? 'error' : ($entry['warnings'] !== [] ? 'warning' : 'ok');
            if ($entry['messages'] !== []) {
                $entry['action'] = 'error';
                $errors[] = ['row' => $entry['row'], 'messages' => array_values(array_unique($entry['messages']))];
            }
            $counters[$entry['action']]++;
            if ($entry['action'] === 'create') {
                $createAmount += (int) $entry['values']['amount'];
            }
            if ($entry['warnings'] !== [] && $entry['action'] !== 'error') {
                $counters['warning']++;
            }
            $entry['valid'] = $entry['messages'] === [];
        }
        unset($entry);

        return ['rows' => $window, 'total_rows' => $total, 'mapping' => $mapping, 'counters' => $counters, 'errors' => $errors, 'file_failures' => $fileFailures, 'create_amount_minor' => $createAmount];
    }

    /** @param array<int, string|null> $mapping @param array<string, mixed> $options */
    private function assertMapping(array $mapping, array $options): void
    {
        $chosen = array_values(array_filter($mapping, static fn ($key): bool => $key !== null));
        if (count($chosen) !== count(array_unique($chosen))) {
            throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
        }
        foreach (['expense_date' => 'التاريخ', 'amount' => 'المبلغ'] as $key => $label) {
            if (! in_array($key, $chosen, true)) {
                throw new RuntimeException("الاستيراد يحتاج عمود «{$label}».");
            }
        }
        if (! in_array('account_code', $chosen, true) && $options['default_account_id'] === null) {
            throw new RuntimeException('حدّد عمود «كود حساب المصروف» أو اختر حساب مصروف افتراضياً للتشغيلة.');
        }
        if ($options['reference_policy'] === self::REFERENCE_REQUIRED && ! in_array('reference', $chosen, true)) {
            throw new RuntimeException('سياسة «المرجع مطلوب» تحتاج عمود «رقم المرجع».');
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

        return ['values' => $present, 'errors' => $errors, 'refs' => [], 'payload' => []];
    }

    /** @return array{0: mixed, 1: ?string} */
    private function normalizeCell(string $key, string $text): array
    {
        $field = Fields::get($key);
        $max = (int) ($field['max'] ?? 255);

        return match ($field['type']) {
            Fields::TYPE_DATE => $this->date($text),
            Fields::TYPE_MONEY => $this->amount($text),
            Fields::TYPE_INTEGER => Normalizer::integer($text, (int) ($field['min'] ?? 0), (int) ($field['max'] ?? 100)),
            Fields::TYPE_ENUM => $this->paymentMethod($text),
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
            // رقم تسلسلي لتاريخ Excel (أصل 1899-12-30)؛ الجزء الكسري وقتٌ من اليوم يُهمل.
            $date = Carbon::create(1899, 12, 30)->addDays((int) $value);

            return $date->year >= 2000 && $date->year <= 2100 ? [$date->toDateString(), null] : [null, 'invalid_date'];
        }
        if ($year === null || ! checkdate((int) $month, (int) $day, (int) $year) || (int) $year < 2000 || (int) $year > 2100) {
            return [null, 'invalid_date'];
        }

        return [sprintf('%04d-%02d-%02d', (int) $year, (int) $month, (int) $day), null];
    }

    /** @return array{0: ?int, 1: ?string} */
    private function amount(string $text): array
    {
        // فاصلة عشرية بأسلوب أوروبي («85,50») كانت ستُقرأ فاصل آلاف فتتضاعف قيمة مصروف مرحَّل ×100: فاصلة يتبعها رقم أو رقمان في نهاية القيمة مرفوضة.
        if (preg_match('/[,،]\d{1,2}$/u', trim(Normalizer::digits($text))) === 1) {
            return [null, 'invalid_money'];
        }
        [$minor, $error] = Normalizer::money($text);
        if ($error !== null) {
            return [null, $error];
        }
        if ($minor <= 0) {
            return [null, 'amount_not_positive'];
        }

        return $minor > self::MAX_AMOUNT_MINOR ? [null, 'money_out_of_range'] : [$minor, null];
    }

    /** @return array{0: ?string, 1: ?string} */
    private function paymentMethod(string $text): array
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
        $accountCodes = $supplierCodes = $centerCodes = [];
        foreach ($entries as $entry) {
            if (isset($entry['values']['account_code'])) {
                $accountCodes[(string) $entry['values']['account_code']] = true;
            }
            if (isset($entry['values']['supplier_code'])) {
                $supplierCodes[(string) $entry['values']['supplier_code']] = true;
            }
            if (isset($entry['values']['cost_center_code'])) {
                $centerCodes[(string) $entry['values']['cost_center_code']] = true;
            }
        }

        $accounts = $this->indexByCode(Account::class, array_keys($accountCodes));
        $suppliers = $this->indexByCode(Partner::class, array_keys($supplierCodes));
        $centers = $this->indexByCode(CostCenter::class, array_keys($centerCodes));

        $categories = [];
        foreach (ExpenseCategory::query()->where('is_active', true)->get(['id', 'name']) as $category) {
            $categories[(string) DocumentDuplicateReservationService::normalizeName($category->name)][] = (string) $category->id;
        }

        $default = null;
        if ($options['default_account_id'] !== null) {
            $default = Account::query()->whereKey($options['default_account_id'])->first();
            if ($default === null || $this->accountProblem($default) !== null) {
                throw new RuntimeException('حساب المصروف الافتراضي غير موجود أو ليس حساب مصروف حركياً نشطاً.');
            }
        }

        foreach ($entries as &$entry) {
            $values = $entry['values'];

            if (isset($values['account_code'])) {
                $account = $accounts[$values['account_code']] ?? null;
                if ($account === null) {
                    $this->addIssue($entry, 'account_not_found', "كود حساب المصروف «{$values['account_code']}» غير موجود في دليل الحسابات.");
                } elseif (($problem = $this->accountProblem($account)) !== null) {
                    $this->addIssue($entry, 'account_invalid', "الحساب «{$values['account_code']}»: {$problem}");
                } else {
                    $entry['refs']['account_id'] = (string) $account->id;
                }
            } elseif ($default !== null) {
                $entry['refs']['account_id'] = (string) $default->id;
            } elseif (! in_array('too_long:account_code', $entry['codes'], true)) {
                $this->addIssue($entry, 'account_required', '«كود حساب المصروف» مطلوب (أو اختر حساباً افتراضياً).');
            }

            if (isset($values['supplier_code'])) {
                $partner = $suppliers[$values['supplier_code']] ?? null;
                if ($partner === null) {
                    $this->addIssue($entry, 'supplier_not_found', "كود المورّد «{$values['supplier_code']}» غير موجود في نطاقك.");
                } elseif (! $partner->isSupplier()) {
                    $this->addIssue($entry, 'supplier_not_supplier', "الطرف «{$values['supplier_code']}» ليس مورّداً.");
                } else {
                    $entry['refs']['partner_id'] = (string) $partner->id;
                }
            }

            if (isset($values['cost_center_code'])) {
                $center = $centers[$values['cost_center_code']] ?? null;
                if ($center === null || ! $center->is_active) {
                    $this->addIssue($entry, 'cost_center_invalid', "مركز التكلفة «{$values['cost_center_code']}» غير موجود أو معطّل.");
                } else {
                    $entry['refs']['cost_center_id'] = (string) $center->id;
                }
            }

            if (isset($values['category'])) {
                $matches = $categories[(string) DocumentDuplicateReservationService::normalizeName($values['category'])] ?? [];
                if (count($matches) === 1) {
                    $entry['refs']['category_id'] = $matches[0];
                } else {
                    $this->addIssue($entry, $matches === [] ? 'category_not_found' : 'category_ambiguous', $matches === []
                        ? "تصنيف المصروف «{$values['category']}» غير موجود أو غير نشط."
                        : "تصنيف المصروف «{$values['category']}» يطابق أكثر من تصنيف نشط؛ أعد تسمية أحدها.");
                }
            }

            if ($options['reference_policy'] === self::REFERENCE_REQUIRED
                && DocumentDuplicateReservationService::normalizeReference($values['reference'] ?? null) === null) {
                $this->addIssue($entry, 'reference_required', '«رقم المرجع» مطلوب بسياسة هذه التشغيلة.');
            }
        }
        unset($entry);
    }

    /**
     * @param  class-string<\Illuminate\Database\Eloquent\Model>  $model
     * @param  list<string>  $codes
     * @return array<string, \Illuminate\Database\Eloquent\Model>
     */
    private function indexByCode(string $model, array $codes): array
    {
        $found = [];
        foreach (array_chunk($codes, self::LOOKUP_CHUNK) as $chunk) {
            foreach ($model::query()->whereIn('code', $chunk)->get() as $record) {
                $found[(string) $record->code] = $record;
            }
        }

        return $found;
    }

    private function accountProblem(Account $account): ?string
    {
        return match (true) {
            $account->type !== 'expense' => 'ليس حساب مصروفات.',
            (bool) $account->is_group => 'حساب تجميعي لا يقبل قيوداً.',
            ! $account->is_active => 'حساب معطّل.',
            default => null,
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  المطابقة بالمصروفات القائمة
    // ═══════════════════════════════════════════════════════════════

    /**
     * يرفض صفاً يطابق مصروفاً قائماً بمعيار الخدمة نفسه (`ExpenseService::lockAndLookup`): مورّد ‖ تاريخ ‖ مبلغ، بغضّ النظر عن المرجع. المؤكَّد يتخطّى الفحص.
     * الفحص هنا استشاري للمعاينة؛ الحَكَم وقت الكتابة هو الخدمة تحت قفل الهوية، وأي تنازع متزامن يعود فشل صفٍّ مسمّى.
     *
     * @param  list<array<string, mixed>>  $entries
     */
    private function matchExisting(array &$entries): void
    {
        $dates = $amounts = [];
        foreach ($entries as $entry) {
            if ($entry['identity'] !== null && ! $entry['confirmed']) {
                $dates[$entry['values']['expense_date']] = true;
                $amounts[(int) $entry['values']['amount']] = true;
            }
        }

        $existing = [];
        if ($dates !== []) {
            $min = min(array_keys($dates));
            $max = max(array_keys($dates));
            foreach (array_chunk(array_keys($amounts), self::LOOKUP_CHUNK) as $chunk) {
                Expense::query()->withoutGlobalScope(BranchScope::class)
                    ->whereDate('expense_date', '>=', $min)->whereDate('expense_date', '<=', $max)->whereIn('amount', $chunk)
                    ->select(['id', 'partner_id', 'vendor_name', 'expense_date', 'amount'])
                    ->chunkById(2000, function ($expenses) use (&$existing, $dates): void {
                        foreach ($expenses as $expense) {
                            $date = $expense->expense_date->toDateString();
                            if (isset($dates[$date])) {
                                $existing[$date.'|'.(int) $expense->amount][] = $expense;
                            }
                        }
                    });
            }
        }

        foreach ($entries as &$entry) {
            if ($entry['identity'] === null || $entry['confirmed']) {
                continue;
            }
            $partnerId = $entry['refs']['partner_id'] ?? null;
            $name = DocumentDuplicateReservationService::normalizeName($entry['values']['vendor_name'] ?? null);
            foreach ($existing[$entry['values']['expense_date'].'|'.(int) $entry['values']['amount']] ?? [] as $expense) {
                $sameVendor = $partnerId !== null
                    ? (string) $expense->partner_id === $partnerId
                    : ($expense->partner_id === null && DocumentDuplicateReservationService::normalizeName($expense->vendor_name) === $name);
                if ($sameVendor) {
                    $this->addIssue($entry, 'existing_expense_matches', 'يوجد مصروف مطابق (المورّد والتاريخ والمبلغ). إن كان تكراراً حقيقياً فأكّده صراحةً.');
                    break;
                }
            }
        }
        unset($entry);
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
        foreach (['expense_date' => 'التاريخ', 'amount' => 'المبلغ'] as $key => $label) {
            if (! isset($entry['values'][$key])) {
                $this->addIssue($entry, $key.'_required', "«{$label}» مطلوب.");

                return 'error';
            }
        }
        if ($entry['confirmed']) {
            $entry['warnings'][] = isset($entry['repeat_in_file'])
                ? 'تكرار مؤكَّد صراحةً (سيُنشأ مصروف مستقل).'
                : 'أُكِّد هذا الصف كتكرار، لكن لم يُكتشف تطابق؛ سيُنشأ مصروف واحد بمعرّف تمييز.';
        }

        $values = $entry['values'];
        $entry['reference'] = $values['reference'] ?? null;
        $entry['occurrence'] = $entry['confirmed'] ? substr(hash('sha256', $options['occurrence_scope'].'|'.$entry['row']), 0, 32) : null;
        $entry['payload'] = [
            'account_id' => $entry['refs']['account_id'],
            'category_id' => $entry['refs']['category_id'] ?? null,
            'partner_id' => $entry['refs']['partner_id'] ?? null,
            'vendor_name' => $values['vendor_name'] ?? null,
            'cost_center_id' => $entry['refs']['cost_center_id'] ?? null,
            'expense_date' => $values['expense_date'],
            'payment_method' => $values['payment_method'] ?? $options['default_payment_method'],
            'description' => $values['description'] ?? null,
            'amount' => (int) $values['amount'],
            'tax_rate' => (int) ($values['tax_rate'] ?? $options['default_tax_rate']),
        ];

        return 'create';
    }

    /** @param array<string, mixed> $row */
    private function planCode(array $row): string
    {
        return $row['action'] === 'create' ? 'c' : 'e';
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
            'date' => $row['values']['expense_date'] ?? null, 'amount_minor' => $row['values']['amount'] ?? null,
            'account_code' => $row['values']['account_code'] ?? null, 'vendor' => $row['values']['vendor_name'] ?? null,
            'reference' => $row['values']['reference'] ?? null, 'confirmed_repeat' => $row['confirmed'],
            // صفٌّ رُفض لأنه يطابق مصروفاً آخر (داخل الملف أو قائماً): الواجهة تعرض له «تكرار حقيقي؟» ليؤكّده المستخدم صراحةً.
            'repeat_candidate' => array_intersect(['duplicate_in_file', 'existing_expense_matches'], $row['codes'] ?? []) !== [],
            'messages' => $row['messages'], 'warnings' => $row['warnings'],
        ];
    }
}
