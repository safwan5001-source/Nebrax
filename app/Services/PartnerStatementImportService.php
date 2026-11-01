<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReconciliation;
use App\Models\Tenant;
use App\Models\User;
use App\Support\ImportUnitFailureException;
use App\Support\PartnerStatementCellParser as Cells;
use App\Support\PartnerStatementImportFields as Fields;
use App\Support\Rbac;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * استيراد كشف حساب طرف (عميل/مورّد) كما أرسله الطرف الآخر — IMP-PS-A1 (المسار أ: تجهيز مقارنة). **لا أثر مالي إطلاقاً**: يكتب جدولَي التجهيز
 * (`partner_statement_reconciliations` و`partner_statement_lines`) وحدهما؛ لا قيد ولا مستند ولا رصيد ولا حركة مخزون ولا ZATCA، ولا استدعاء لـ`LedgerService` أو خدمات المستندات
 * (يحرس ذلك اختبارٌ ساكن). **لا مطابقة هنا** (PS-A2).
 *
 *  - **وحدة التنفيذ الملف كله** (ذرّي): أي خطأ صف يمنع الكل — لا كشفٌ ناقص السطور بسبب ملف.
 *  - **القرارات المعتمدة (2026-11-01):** D-PS-01 ريال فقط (عملة أخرى في الخيارات أو الصف ⇒ رفض، بلا تحويل) · D-PS-02 صلاحيات `partner_statements.*` مستقلة (على بوابة المجال)
 *    + `partners.view` هنا · D-PS-03 `CompanyWide` والطرف يُحلّ كما يفعل `ReportService::partnerStatement` · P-1 تسامح التاريخ ٣ أيام (0–30) · P-2 تسامح المبلغ ٠ هللة (لا نسبة)
 *    · P-3 اتجاه العمود الواحد إلزامي ومُعلَن · P-4 المعكوسة تدخل المطابقة وفق مصدر التقرير بلا مضاعفة (تُسجَّل في السياسة، تستعملها PS-A2) · P-5 الطرف على مستوى المؤسسة وفلتر فرع اختياري ضمن صلاحيات الفاعل.
 *  - **إعادة رفع الملف نفسه** (بصمة المحتوى) لنفس الطرف والدور والفترة تعيد المقارنة القائمة (`replayed`) ولا تنشئ ثانية؛ القفل الاستشاري + الفهرس الفريد.
 *  - **عدم كشف الأطراف:** طرفٌ غير موجود/من مؤسسة أخرى/غير مرئي للفاعل/لا يطابق الدور ⇒ رسالة واحدة متطابقة؛ والفاعل بلا `partners.view` يُرفض بها قبل أي قراءة.
 *  - الرسائل بنص عربي وأرقام صفوف كما في Excel (العناوين صف ١).
 */
class PartnerStatementImportService
{
    public const MAX_ROWS = 2000;
    public const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;
    public const MAX_PERIOD_DAYS = 1830;
    public const DEFAULT_DATE_TOLERANCE_DAYS = 3;
    public const MAX_DATE_TOLERANCE_DAYS = 30;
    public const DEFAULT_AMOUNT_TOLERANCE_MINOR = 0;
    public const MAX_AMOUNT_TOLERANCE_MINOR = 10000;
    private const PREVIEW_ROW_LIMIT = 200;
    private const INSERT_CHUNK = 500;
    private const MAX_BALANCE_WARNINGS = 20;

    public const PARTNER_UNAVAILABLE = 'الطرف غير متاح لك في هذا الدور.';

    public function __construct(private readonly TenantContext $tenantContext) {}

    // ═══════════════════════════════════════════════════════════════
    //  العقد والقالب والفحص (لا يقرأ بيانات أطراف)
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
            ['2026-09-01', 'INV-1001', '', 'فاتورة مبيعات', '1150.00', '', '', '1150.00', 'SAR', 'فاتورة'],
            ['2026-09-10', 'PAY-77', '', 'سداد', '', '500.00', '', '650.00', 'SAR', 'دفعة'],
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
        $partner = $this->assertAccess($resolved, $userId);
        $parsed = $this->parse($file, $resolved, $maxRows);
        $rows = array_slice($parsed['rows'], 0, self::PREVIEW_ROW_LIMIT);
        $existing = $this->existing($resolved, $this->fileHash($file));

        return [
            'partner_id' => $resolved['partner_id'], 'partner_name' => $partner->name, 'role' => $resolved['role'],
            'period_from' => $resolved['period_from'], 'period_to' => $resolved['period_to'], 'currency' => 'SAR',
            'policy' => $this->policy($resolved), 'mapping' => $parsed['mapping'],
            'total_rows' => $parsed['total_rows'], 'line_rows' => $parsed['counters']['line'], 'warning_rows' => $parsed['counters']['warning'],
            'error_rows' => $parsed['counters']['error'], 'valid_rows' => $parsed['total_rows'] - $parsed['counters']['error'], 'invalid_rows' => $parsed['counters']['error'],
            'total_debit_minor' => $parsed['total_debit'], 'total_credit_minor' => $parsed['total_credit'],
            'checks' => $parsed['checks'],
            'already_imported' => $existing !== null, 'existing_reconciliation_id' => $existing?->id,
            'rows' => array_map(fn (array $row): array => $this->rowSummary($row), $rows),
            'rows_shown' => count($rows), 'rows_truncated' => count($parsed['rows']) > count($rows),
            'errors' => $parsed['errors'],
        ];
    }

    /**
     * ينشئ رأس المقارنة وسطورها المجهَّزة في معاملة واحدة، أو لا شيء؛ أو يعيد القائمة (`replayed`) لإعادة رفع الملف نفسه.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function apply(UploadedFile $file, array $options, ?string $userId, ?string $importJobId = null, int $maxRows = self::MAX_ROWS): array
    {
        $resolved = $this->options($options);

        return DB::transaction(function () use ($file, $resolved, $userId, $importJobId, $maxRows): array {
            $partner = $this->assertAccess($resolved, $userId);
            $parsed = $this->parse($file, $resolved, $maxRows);

            if ($parsed['total_rows'] === 0) {
                throw new RuntimeException('لا يحتوي الملف صفوف بيانات قابلة للتطبيق.');
            }
            if ($parsed['counters']['error'] > 0) {
                throw new ImportUnitFailureException('لا يمكن تطبيق الاستيراد قبل معالجة الأخطاء الظاهرة في المعاينة.', $this->rowFailures($parsed['rows']));
            }

            $hash = $this->fileHash($file);
            $this->lockIdentity($resolved, $hash);
            $existing = $this->existing($resolved, $hash);
            if ($existing !== null) {
                return $this->result($existing, $parsed, $partner, created: 0, replayed: true);
            }

            $reconciliation = PartnerStatementReconciliation::create([
                'partner_id' => $resolved['partner_id'], 'role' => $resolved['role'],
                'period_from' => $resolved['period_from'], 'period_to' => $resolved['period_to'], 'currency' => 'SAR',
                'status' => PartnerStatementReconciliation::STATUS_DRAFT, 'original_filename' => mb_substr((string) $file->getClientOriginalName(), 0, 255) ?: null,
                'file_sha256' => $hash, 'source_import_job_id' => $importJobId, 'line_count' => count($parsed['rows']),
                'total_debit_minor' => $parsed['total_debit'], 'total_credit_minor' => $parsed['total_credit'],
                'policy' => $this->policy($resolved), 'checks' => $parsed['checks'], 'created_by' => $userId,
            ]);

            $tenantId = (string) $this->tenantContext->id();
            $now = now();
            foreach (array_chunk($parsed['rows'], self::INSERT_CHUNK) as $chunk) {
                PartnerStatementLine::query()->insert(array_map(static fn (array $row): array => [
                    'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'reconciliation_id' => $reconciliation->id, 'ordinal' => $row['row'],
                    'line_date' => $row['line_date'], 'reference' => $row['reference'], 'reference_key' => DocumentDuplicateReservationService::normalizeReference($row['reference']),
                    'our_reference' => $row['our_reference'], 'our_reference_key' => DocumentDuplicateReservationService::normalizeReference($row['our_reference']),
                    'description' => $row['description'], 'debit_minor' => $row['debit_minor'], 'credit_minor' => $row['credit_minor'],
                    'balance_minor' => $row['balance_minor'], 'kind' => $row['kind'], 'created_at' => $now, 'updated_at' => $now,
                ], $chunk));
            }

            return $this->result($reconciliation, $parsed, $partner, created: 1, replayed: false);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  الخيارات والوصول
    // ═══════════════════════════════════════════════════════════════

    /**
     * @param  array<string, mixed>  $options
     * @return array{partner_id: string, role: string, period_from: string, period_to: string, amount_direction: ?string, date_tolerance_days: int, amount_tolerance_minor: int, branch_id: ?string, mapping: array<int, string|null>|null}
     */
    public function options(array $options): array
    {
        $partner = $this->uuid($options['partner_id'] ?? null, 'اختر الطرف.');
        $role = (string) ($options['role'] ?? '');
        if (! in_array($role, PartnerStatementReconciliation::ROLES, true)) {
            throw new RuntimeException('الدور مطلوب: عميل أو مورّد.');
        }

        // D-PS-01: SAR فقط. العملة تُعلَن في الخيارات أو تُترك فتُفترض الريال؛ أي قيمة أخرى ترفض ولا تُحوَّل.
        $currency = $options['currency'] ?? null;
        if ($currency !== null && $currency !== '' && ! Cells::isSar((string) $currency)) {
            throw new RuntimeException('كشوف الأطراف بالريال السعودي (SAR) فقط في هذه النسخة؛ العملات الأخرى غير مدعومة.');
        }

        $from = $this->date($options['period_from'] ?? null, 'بداية الفترة مطلوبة بصيغة YYYY-MM-DD.');
        $to = $this->date($options['period_to'] ?? null, 'نهاية الفترة مطلوبة بصيغة YYYY-MM-DD.');
        if ($from > $to) {
            throw new RuntimeException('بداية الفترة بعد نهايتها.');
        }
        if ((new \DateTimeImmutable($from))->diff(new \DateTimeImmutable($to))->days > self::MAX_PERIOD_DAYS) {
            throw new RuntimeException('فترة الكشف تتجاوز خمس سنوات.');
        }

        $direction = $options['amount_direction'] ?? null;
        $direction = $direction === null || $direction === '' ? null : (string) $direction;
        if ($direction !== null && ! in_array($direction, Fields::DIRECTIONS, true)) {
            throw new RuntimeException('اتجاه المبلغ غير صالح.');
        }

        $dateTolerance = $this->intOption($options['date_tolerance_days'] ?? self::DEFAULT_DATE_TOLERANCE_DAYS, 0, self::MAX_DATE_TOLERANCE_DAYS, 'فرق التاريخ المسموح يجب أن يكون عدداً صحيحاً بين 0 و'.self::MAX_DATE_TOLERANCE_DAYS.' يوماً.');
        // P-2: بالهللات فقط — لا نسبة مئوية ولا كسور؛ النص الذي يحمل % يُرفض صراحةً.
        $rawAmount = $options['amount_tolerance_minor'] ?? self::DEFAULT_AMOUNT_TOLERANCE_MINOR;
        if (is_string($rawAmount) && preg_match('/[%٪]/u', $rawAmount) === 1) {
            throw new RuntimeException('فرق المبلغ المسموح بالهللات لا بالنسبة المئوية.');
        }
        $amountTolerance = $this->intOption($rawAmount, 0, self::MAX_AMOUNT_TOLERANCE_MINOR, 'فرق المبلغ المسموح عدد صحيح من الهللات بين 0 و'.self::MAX_AMOUNT_TOLERANCE_MINOR.'.');

        $branch = ($options['branch_id'] ?? null) === null || $options['branch_id'] === '' ? null : $this->uuid($options['branch_id'], 'معرّف الفرع غير صالح.');

        $mapping = null;
        if (isset($options['mapping']) && is_array($options['mapping'])) {
            $mapping = [];
            foreach ($options['mapping'] as $index => $key) {
                if (! is_numeric($index)) {
                    continue;
                }
                $key = $key === null || $key === '' || $key === 'ignore' ? null : (string) $key;
                if ($key !== null && Fields::get($key) === null) {
                    throw new RuntimeException('أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد كشف الطرف.');
                }
                $mapping[(int) $index] = $key;
            }
        }

        return [
            'partner_id' => $partner, 'role' => $role, 'period_from' => $from, 'period_to' => $to, 'amount_direction' => $direction,
            'date_tolerance_days' => $dateTolerance, 'amount_tolerance_minor' => $amountTolerance, 'branch_id' => $branch, 'mapping' => $mapping,
        ];
    }

    /**
     * ضوابط الاطلاع (D-PS-02/03): الفاعل مجهول أو غير نشط أو بلا `partners.view` ⇒ رفض؛ الطرف يُحلّ كما يفعل التقرير (`BranchScope::reference`، داخل المؤسسة فقط) ويطابق الدور؛
     * الفرع (إن طُلب) ضمن نطاق الفاعل. كل فشل طرفٍ برسالة واحدة (لا تمييز بين غير موجود/غير مرئي/دور خاطئ). عملة المؤسسة يجب أن تكون SAR.
     *
     * @param  array{partner_id: string, role: string, branch_id: ?string}  $options
     */
    public function assertAccess(array $options, ?string $userId): Partner
    {
        $user = $userId !== null ? User::query()->find($userId) : null;
        if ($user === null || $user->is_active === false || ! Rbac::allows((string) $user->role, 'partners.view')) {
            throw new RuntimeException(self::PARTNER_UNAVAILABLE);
        }

        $tenant = Tenant::query()->find($this->tenantContext->id());
        if ($tenant === null || strtoupper((string) $tenant->currency) !== 'SAR') {
            throw new RuntimeException('كشوف الأطراف بالريال السعودي فقط، وعملة مؤسستك مختلفة.');
        }

        $partner = BranchScope::reference(Partner::class)->whereKey($options['partner_id'])->first();
        $types = $options['role'] === PartnerStatementReconciliation::ROLE_CUSTOMER ? ['customer', 'both'] : ['supplier', 'both'];
        if ($partner === null || ! in_array((string) $partner->type, $types, true)) {
            throw new RuntimeException(self::PARTNER_UNAVAILABLE);
        }

        if ($options['branch_id'] !== null) {
            $branch = Branch::query()->whereKey($options['branch_id'])->first();
            if ($branch === null || ! $user->canAccessBranch($branch->id)) {
                throw new RuntimeException('هذا الفرع خارج نطاق صلاحياتك.');
            }
        }

        return $partner;
    }

    private function uuid(mixed $value, string $message): string
    {
        $id = strtolower(trim((string) $value));
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id) !== 1) {
            throw new RuntimeException($message);
        }

        return $id;
    }

    private function date(mixed $value, string $message): string
    {
        $date = (string) $value;
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1 || ! checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4))) {
            throw new RuntimeException($message);
        }

        return $date;
    }

    private function intOption(mixed $value, int $min, int $max, string $message): int
    {
        if (is_bool($value) || (! is_int($value) && ! (is_string($value) && preg_match('/^\d{1,9}$/', trim($value)) === 1))) {
            throw new RuntimeException($message);
        }
        $number = (int) $value;
        if ($number < $min || $number > $max) {
            throw new RuntimeException($message);
        }

        return $number;
    }

    /** السياسات المجمَّدة مع المقارنة (تستعملها المطابقة PS-A2). @param array<string, mixed> $options @return array<string, mixed> */
    private function policy(array $options): array
    {
        return [
            'version' => 1, 'currency' => 'SAR',
            'date_tolerance_days' => $options['date_tolerance_days'], 'amount_tolerance_minor' => $options['amount_tolerance_minor'],
            'amount_direction' => $options['amount_direction'], 'include_reversed' => true, 'branch_id' => $options['branch_id'],
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

    private function fileHash(UploadedFile $file): string
    {
        return (string) hash_file('sha256', (string) $file->getRealPath());
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
                'line_date' => null, 'reference' => null, 'our_reference' => null, 'description' => null,
                'debit_minor' => 0, 'credit_minor' => 0, 'balance_minor' => null, 'kind' => null, 'action' => 'error',
            ];
            if (count($values) > count($headers)) {
                $entry['messages'][] = 'عدد الأعمدة في هذا الصف يتجاوز صف العناوين، فبعض القيم ستسقط. صحّح الملف.';
            }
            foreach ($mapping as $index => $key) {
                if ($key !== null) {
                    $entry['cells'][$key] = $this->unquote((string) ($values[$index] ?? ''));
                }
            }
            $this->readDate($entry, $options);
            $this->readTexts($entry);
            $this->readCurrency($entry);
            $this->readAmounts($entry, $mapping, $options);
            $this->readBalance($entry);
            $this->readKind($entry);
            $entries[] = $entry;
        }

        $this->flagRepeats($entries);
        $checks = $this->balanceChecks($entries);

        $counters = ['line' => 0, 'warning' => 0, 'error' => 0];
        $errors = [];
        $totalDebit = $totalCredit = 0;
        foreach ($entries as &$entry) {
            if ($entry['messages'] !== []) {
                $entry['action'] = 'error';
                $counters['error']++;
                $errors[] = ['row' => $entry['row'], 'messages' => array_values(array_unique($entry['messages']))];
            } else {
                $entry['action'] = 'line';
                $counters['line']++;
                $totalDebit += $entry['debit_minor'];
                $totalCredit += $entry['credit_minor'];
                if ($entry['warnings'] !== []) {
                    $counters['warning']++;
                }
            }
            $entry['valid'] = $entry['messages'] === [];
            $entry['status'] = ! $entry['valid'] ? 'error' : ($entry['warnings'] !== [] ? 'warning' : 'ok');
        }
        unset($entry);

        return [
            'rows' => $entries, 'total_rows' => count($entries), 'mapping' => $mapping, 'counters' => $counters, 'errors' => $errors,
            'total_debit' => $totalDebit, 'total_credit' => $totalCredit, 'checks' => $checks,
        ];
    }

    /** @param array<int, string|null> $mapping @param array<string, mixed> $options */
    private function assertMapping(array $mapping, array $options): void
    {
        $chosen = array_values(array_filter($mapping, static fn ($key): bool => $key !== null));
        if (count($chosen) !== count(array_unique($chosen))) {
            throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
        }
        if (! in_array('line_date', $chosen, true)) {
            throw new RuntimeException('الاستيراد يحتاج عمود «'.Fields::get('line_date')['label_ar'].'».');
        }
        $hasDebit = in_array('debit', $chosen, true);
        $hasCredit = in_array('credit', $chosen, true);
        $hasAmount = in_array('amount', $chosen, true);
        if ($hasAmount && ($hasDebit || $hasCredit)) {
            throw new RuntimeException('استعمل إمّا عمودَي «مدين» و«دائن» أو عمود «المبلغ» الواحد، لا الاثنين معاً.');
        }
        if (! $hasAmount && ! ($hasDebit && $hasCredit)) {
            throw new RuntimeException($hasDebit || $hasCredit
                ? 'عمود «مدين» أو «دائن» وحده ملتبس؛ اربط العمودين معاً، أو استعمل عمود «المبلغ» الواحد مع تحديد اتجاهه.'
                : 'الملف يحتاج عمودَي «مدين» و«دائن»، أو عمود «المبلغ» الواحد مع تحديد اتجاهه.');
        }
        if ($hasAmount && $options['amount_direction'] === null) {
            throw new RuntimeException('عمود «المبلغ» الواحد يلزمه تحديد اتجاهه صراحةً (الموجب مدين أم دائن في كشف الطرف الآخر)؛ لا يُخمَّن.');
        }
        if (! $hasAmount && $options['amount_direction'] !== null) {
            throw new RuntimeException('اتجاه المبلغ يخص ملف العمود الواحد وحده؛ عمودا «مدين» و«دائن» يحدّدان الاتجاه بنفسيهما.');
        }
    }

    /** @param array<string, mixed> $entry @param array<string, mixed> $options */
    private function readDate(array &$entry, array $options): void
    {
        $text = (string) ($entry['cells']['line_date'] ?? '');
        if (trim($text) === '') {
            $entry['messages'][] = 'التاريخ فارغ.';

            return;
        }
        [$date, $error] = Cells::date($text);
        if ($error !== null || $date === null) {
            $entry['messages'][] = 'التاريخ غير صالح؛ استخدم YYYY-MM-DD أو DD/MM/YYYY.';

            return;
        }
        $entry['line_date'] = $date;
        if ($date < $options['period_from'] || $date > $options['period_to']) {
            $entry['warnings'][] = 'تاريخ السطر خارج فترة الكشف المعلنة.';
        }
    }

    /** @param array<string, mixed> $entry */
    private function readTexts(array &$entry): void
    {
        foreach (['reference' => 100, 'our_reference' => 100, 'description' => 500] as $key => $max) {
            $text = trim((string) ($entry['cells'][$key] ?? ''));
            if ($text === '') {
                continue;
            }
            if (mb_strlen($text) > $max) {
                $entry['messages'][] = Fields::get($key)['label_ar']." تتجاوز {$max} حرفاً.";

                continue;
            }
            $entry[$key] = $text;
        }
    }

    /** D-PS-01: أي عملة صريحة غير الريال تُرفض (لا تحويل). @param array<string, mixed> $entry */
    private function readCurrency(array &$entry): void
    {
        $text = trim((string) ($entry['cells']['currency'] ?? ''));
        if ($text !== '' && ! Cells::isSar($text)) {
            $entry['messages'][] = 'العملة «'.mb_substr($text, 0, 16).'» غير مدعومة؛ الريال السعودي (SAR) فقط.';
        }
    }

    /** @param array<string, mixed> $entry @param array<int, string|null> $mapping @param array<string, mixed> $options */
    private function readAmounts(array &$entry, array $mapping, array $options): void
    {
        if (in_array('amount', $mapping, true)) {
            $text = trim((string) ($entry['cells']['amount'] ?? ''));
            if ($text === '') {
                $entry['messages'][] = 'المبلغ فارغ.';

                return;
            }
            [$value, $error] = Cells::signedMoney($text);
            if ($error !== null || $value === null) {
                $entry['messages'][] = 'المبلغ يجب أن يكون رقماً بمنزلتين عشريتين على الأكثر (والإشارة السالبة `-` أو الأقواس).';

                return;
            }
            if ($value === 0) {
                $entry['messages'][] = 'المبلغ صفر؛ لا يُستورد سطرٌ بلا مبلغ.';

                return;
            }
            $debit = ($options['amount_direction'] === Fields::DIRECTION_POSITIVE_DEBIT) === ($value > 0);
            $entry[$debit ? 'debit_minor' : 'credit_minor'] = abs($value);

            return;
        }

        $values = ['debit' => 0, 'credit' => 0];
        $invalid = false;
        foreach (array_keys($values) as $key) {
            $text = trim((string) ($entry['cells'][$key] ?? ''));
            if ($text === '') {
                continue;
            }
            [$value, $error] = Cells::money($text);
            if ($error !== null || $value === null) {
                $entry['messages'][] = 'عمود «'.Fields::get($key)['label_ar'].'» يجب أن يكون رقماً غير سالب بمنزلتين عشريتين على الأكثر.';
                $invalid = true;

                continue;
            }
            $values[$key] = $value;
        }
        if ($invalid) {
            return;
        }
        if ($values['debit'] > 0 && $values['credit'] > 0) {
            $entry['messages'][] = 'السطر يحمل «مدين» و«دائن» معاً؛ سطرٌ واحد = اتجاه واحد.';

            return;
        }
        if ($values['debit'] === 0 && $values['credit'] === 0) {
            $entry['messages'][] = 'السطر بلا مبلغ (مدين ودائن فارغان أو صفر).';

            return;
        }
        $entry['debit_minor'] = $values['debit'];
        $entry['credit_minor'] = $values['credit'];
    }

    /** @param array<string, mixed> $entry */
    private function readBalance(array &$entry): void
    {
        $text = trim((string) ($entry['cells']['balance'] ?? ''));
        if ($text === '') {
            return;
        }
        [$value, $error] = Cells::signedMoney($text);
        if ($error !== null) {
            $entry['messages'][] = 'الرصيد المطبوع غير صالح.';

            return;
        }
        $entry['balance_minor'] = $value;
    }

    /** @param array<string, mixed> $entry */
    private function readKind(array &$entry): void
    {
        $text = trim((string) ($entry['cells']['kind'] ?? ''));
        if ($text === '') {
            return;
        }
        [$kind, $recognized] = Cells::kind($text);
        if (! $recognized) {
            $entry['warnings'][] = 'نوع الحركة «'.mb_substr($text, 0, 24).'» غير معروف؛ سيُحفظ بلا نوع.';
        }
        $entry['kind'] = $kind;
    }

    /** تكرار التاريخ والمرجع والاتجاه والمبلغ في الملف: تنبيه فقط (قد يكون لصقاً مزدوجاً) — القرار لصاحب الملف. @param list<array<string, mixed>> $entries */
    private function flagRepeats(array &$entries): void
    {
        $seen = [];
        foreach ($entries as $entry) {
            if ($entry['messages'] !== [] || $entry['line_date'] === null) {
                continue;
            }
            $seen[implode('|', [$entry['line_date'], (string) $entry['reference'], $entry['debit_minor'], $entry['credit_minor']])][] = $entry['ordinal'];
        }
        foreach ($seen as $ordinals) {
            if (count($ordinals) < 2) {
                continue;
            }
            foreach ($ordinals as $ordinal) {
                $others = implode('، ', array_map(fn (int $o): string => (string) $entries[$o]['row'], array_values(array_diff($ordinals, [$ordinal]))));
                $entries[$ordinal]['warnings'][] = "السطر مكرّر في الملف (الصفوف: {$others}) بالتاريخ والمرجع والمبلغ نفسها.";
            }
        }
    }

    /**
     * اتساق الأرصدة المطبوعة (تنبيه لا مانع): بين صفين متتاليين مطبوع رصيداهما يجب أن يساوي |فرق الرصيدين| مبلغ السطر الثاني. ساكن عن إشارة الرصيد (قد يُطبع مدينُ
     * العميل موجباً أو سالباً)، فلا يخمّن اتجاهها؛ عدم الاتساق يدلّ غالباً على ملف مبتور أو أعمدة مختلطة. الرصيد لا يدخل المطابقة أبداً.
     *
     * @param  list<array<string, mixed>>  $entries
     * @return array{balance_rows: int, balance_pairs_checked: int, balance_mismatches: list<int>, balance_mismatches_truncated: bool}
     */
    private function balanceChecks(array &$entries): array
    {
        $rows = $pairs = 0;
        $mismatches = [];
        $previous = null;
        foreach ($entries as $index => $entry) {
            if ($entry['messages'] !== [] || $entry['balance_minor'] === null) {
                $previous = null;

                continue;
            }
            $rows++;
            if ($previous !== null) {
                $pairs++;
                if (abs($entry['balance_minor'] - $previous) !== abs($entry['debit_minor'] - $entry['credit_minor'])) {
                    $mismatches[] = $entry['row'];
                    if (count($mismatches) <= self::MAX_BALANCE_WARNINGS) {
                        $entries[$index]['warnings'][] = 'الرصيد المطبوع لا يتّسق مع الرصيد السابق ومبلغ هذا السطر (قد يكون الملف مبتوراً أو الأعمدة مختلطة).';
                    }
                }
            }
            $previous = $entry['balance_minor'];
        }

        return [
            'balance_rows' => $rows, 'balance_pairs_checked' => $pairs,
            'balance_mismatches' => array_slice($mismatches, 0, self::MAX_BALANCE_WARNINGS), 'balance_mismatches_truncated' => count($mismatches) > self::MAX_BALANCE_WARNINGS,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  الهوية والتكرار
    // ═══════════════════════════════════════════════════════════════

    /** @param array<string, mixed> $options */
    private function existing(array $options, string $hash): ?PartnerStatementReconciliation
    {
        return PartnerStatementReconciliation::query()
            ->where('partner_id', $options['partner_id'])->where('role', $options['role'])
            ->whereDate('period_from', $options['period_from'])->whereDate('period_to', $options['period_to'])
            ->where('file_sha256', $hash)
            ->first();
    }

    /** قفل استشاري على هوية الرفع داخل المعاملة: متسابقان على الملف نفسه يتسلسلان فيرى الثاني الأول (والفهرس الفريد شبكة أخيرة، لا يُلتقط خطؤه داخل معاملة PostgreSQL). @param array<string, mixed> $options */
    private function lockIdentity(array $options, string $hash): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
                'partner-statement:'.$this->tenantContext->id().':'.$options['partner_id'].':'.$options['role'].':'.$options['period_from'].':'.$options['period_to'].':'.$hash,
            ]);
        }
    }

    /** @param array<string, mixed> $parsed @return array<string, mixed> */
    private function result(PartnerStatementReconciliation $reconciliation, array $parsed, Partner $partner, int $created, bool $replayed): array
    {
        return [
            'reconciliation_id' => $reconciliation->id, 'partner_id' => $partner->id, 'partner_name' => $partner->name, 'role' => $reconciliation->role,
            'period_from' => $reconciliation->period_from->toDateString(), 'period_to' => $reconciliation->period_to->toDateString(),
            'created' => $created, 'updated' => 0, 'skipped' => $replayed ? 1 : 0, 'replayed' => $replayed,
            'lines' => (int) $reconciliation->line_count, 'total_rows' => $parsed['total_rows'],
            'total_debit_minor' => (int) $reconciliation->total_debit_minor, 'total_credit_minor' => (int) $reconciliation->total_credit_minor,
            'results' => array_map(fn (array $row): array => $this->rowSummary($row), $parsed['rows']),
        ];
    }

    /** التصدير يسبق الخلايا التي تبدأ بـ `= + - @` بفاصلة عليا؛ القارئ لا يزيلها فنزيلها هنا. */
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
            'line_date' => $row['line_date'], 'reference' => $row['reference'], 'our_reference' => $row['our_reference'], 'description' => $row['description'],
            'debit_minor' => $row['debit_minor'], 'credit_minor' => $row['credit_minor'], 'balance_minor' => $row['balance_minor'], 'kind' => $row['kind'],
            'messages' => $row['messages'], 'warnings' => $row['warnings'],
        ];
    }
}
