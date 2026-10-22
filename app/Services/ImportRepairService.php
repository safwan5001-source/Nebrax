<?php

namespace App\Services;

use App\Contracts\ImportDomainAdapter;
use App\Contracts\ImportFailureExportAdapter;
use App\Models\ImportJob;
use App\Models\ImportJobUnit;
use App\Support\ImportJobStatus;
use App\Support\ImportRepairException;
use App\Tenancy\BranchContext;
use Illuminate\Http\UploadedFile;
use RuntimeException;

/**
 * إنشاء تشغيلة إصلاح فرعية من ملفٍّ مصحَّح (IMP-H1-S8b). **للقراءة فقط حتى الإنشاء:** يتحقق من عضوية كل وحدةٍ ثم يفوّض الإنشاء إلى
 * `ImportJobService::create` (المعاينة والربط والخيارات المجمَّدة والفرع كلها كما في أي تشغيلة)؛ لا مطالبة هنا — تُنتزع الوحدات وحدةً وحدة
 * عند ترحيل كل قطعة (`ImportRepairClaims`).
 */
class ImportRepairService
{
    public function __construct(
        private readonly ImportJobService $jobs,
        private readonly ImportDomainRegistry $domains,
        private readonly ImportRepairClaims $claims,
        private readonly BranchContext $branch,
    ) {}

    /**
     * @param  array<string, mixed>|null  $options
     */
    public function start(
        ImportJob $parent,
        UploadedFile $file,
        ?string $idempotencyKey,
        ?string $userId,
        ?array $options,
        ?string $previewId,
        ?string $previewHash,
    ): ImportJob {
        if ($parent->status !== ImportJobStatus::FAILED) {
            throw new ImportRepairException('repair_not_available', 'لا يُصلَح إلا تشغيلة فاشلة.');
        }
        $adapter = $this->domains->for($parent->domain);
        if ($adapter->unit() !== ImportDomainAdapter::UNIT_ROW || ! $adapter instanceof ImportFailureExportAdapter) {
            throw new ImportRepairException('repair_domain_unsupported', 'هذا المجال لا يدعم الإصلاح الجزئي (وحدته ذرّية: صحّح الملف وأعد رفعه).');
        }
        if ($parent->branch_id !== null && $parent->branch_id !== $this->branch->id()) {
            throw new ImportRepairException('repair_branch_mismatch', 'الإصلاح يُنفَّذ في الفرع الذي أُنشئت فيه التشغيلة الأصلية.');
        }

        $extension = strtolower((string) $file->getClientOriginalExtension());
        $path = (string) $file->getRealPath();
        try {
            $refs = $this->claims->refsInFile($path, $extension, $adapter->maxRows());
        } catch (RuntimeException $e) {
            throw new ImportRepairException('repair_ref_missing', $e->getMessage());
        }
        if ($refs === []) {
            throw new ImportRepairException('repair_ref_missing', 'ملف الإصلاح لا يحمل صفوفاً.');
        }

        $this->assertNoCsvQuotePrefix($path, $extension);
        $this->assertMembership($parent, $refs);

        return $this->jobs->create($file, $parent->domain, $idempotencyKey, $userId, null, $options, $previewId, $previewHash, $parent->id);
    }

    /**
     * @param  list<string>  $refs
     */
    private function assertMembership(ImportJob $parent, array $refs): void
    {
        $seen = [];
        foreach ($refs as $index => $ref) {
            $row = $index + 1;
            if ($ref === '') {
                throw new ImportRepairException('repair_ref_missing', "الصف {$row} من الملف بلا معرّف مصدر (_awj_unit_ref).");
            }
            if (isset($seen[$ref])) {
                throw new ImportRepairException('repair_ref_duplicate', "المعرّف في الصف {$row} مكرّر داخل الملف.");
            }
            $seen[$ref] = true;
        }

        $units = ImportJobUnit::query()
            ->where('import_job_id', $parent->id)
            ->whereIn('source_unit_ref', $refs)
            ->pluck('status', 'source_unit_ref')->all();
        foreach ($refs as $index => $ref) {
            $row = $index + 1;
            if (! isset($units[$ref])) {
                throw new ImportRepairException('repair_ref_unknown', "المعرّف في الصف {$row} لا يخصّ هذه التشغيلة.");
            }
            if ($units[$ref] !== ImportJobUnit::FAILED) {
                throw new ImportRepairException('repair_ref_not_failed', "الوحدة في الصف {$row} ليست فاشلة (أُصلحت سابقاً).");
            }
        }
    }

    /**
     * كاتب CSV يسبق قيمَ `= + - @` بعلامة اقتباس (حماية من حقن الصيغ). ملفٌ CSV منزَّل ثم مُعاد رفعه يحمل تلك العلامة في قيمةٍ كرمز صنفٍ يبدأ
     * بـ«-» فيُستورد الرمز بالعلامة. نرفض بدل أن نكتب قيمةً مشوَّهة بصمت، ونحيل إلى XLSX (نصوصه مضمّنة بلا علامة).
     */
    private function assertNoCsvQuotePrefix(string $path, string $extension): void
    {
        if (! in_array($extension, ['csv', 'txt'], true)) {
            return;
        }
        $table = \App\Support\SpreadsheetReader::read($path, $extension, 20000, ProductImportService::MAX_COLUMNS);
        foreach (array_slice($table, 1) as $values) {
            foreach ($values as $cell) {
                if (preg_match("/^'[=+\\-@\\t\\r]/", (string) $cell) === 1) {
                    throw new ImportRepairException('repair_csv_quote_prefix', 'قيمةٌ في الملف تبدأ بعلامة اقتباس أضافها CSV (حماية من حقن الصيغ). نزّل الصفوف الفاشلة بصيغة XLSX وأعد رفعها.');
                }
            }
        }
    }
}
