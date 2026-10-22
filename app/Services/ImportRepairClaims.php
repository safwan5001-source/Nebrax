<?php

namespace App\Services;

use App\Models\ImportJob;
use App\Models\ImportJobUnit;
use App\Support\ImportUnitFailureException;
use App\Support\SpreadsheetReader;

/**
 * قراءة معرّفات المصدر من ملف إصلاح ومطالبتها **ذرّياً** (IMP-H1-S8b).
 *
 * المطالبة تنتقل `failed → repaired` بتحديثٍ شرطيٍّ واحد لكل نافذة، وتُنفَّذ **داخل معاملة القطعة نفسها وقبل كتابتها**: تراجُع الكتابة يُرجع
 * المطالبة معها فتبقى الوحدة `failed` وقابلة للإصلاح، وطفلٌ يتوقف في المنتصف لا يحجز شيئاً (لا عقد إيجار ولا انقضاء). تشغيلتان فرعيّتان على
 * المعرّفات نفسها: الأولى تنتزعها، والثانية تقع على صفرٍ مطالَب فتفشل نافذتها بـ`repair_ref_already_used` (وتتراجع كاملةً).
 */
class ImportRepairClaims
{
    public const COLUMN = '_awj_unit_ref';

    /**
     * معرّفات المصدر لكل صفوف البيانات الفعلية في الملف بترتيبها (من 0) — يُستعمل عند إنشاء التشغيلة وعند كل قطعة.
     *
     * @return list<string> يحمل `''` لصفٍّ بلا معرّف
     *
     * @throws \RuntimeException إن غاب عمود المعرّف
     */
    public function refsInFile(string $path, string $extension, int $maxRows): array
    {
        $table = SpreadsheetReader::read($path, $extension, $maxRows, ProductImportService::MAX_COLUMNS);
        if ($table === []) {
            throw new \RuntimeException('الملف فارغ.');
        }
        $column = array_search(self::COLUMN, array_map(static fn ($h): string => strtolower(trim((string) $h)), $table[0]), true);
        if ($column === false) {
            throw new \RuntimeException('ملف الإصلاح يجب أن يحمل عمود «'.self::COLUMN.'» كما نزل من ملف الصفوف الفاشلة.');
        }

        $refs = [];
        foreach (array_slice($table, 1) as $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $refs[] = strtolower(trim((string) ($values[$column] ?? '')));
        }

        return $refs;
    }

    /**
     * يطالب بمعرّفات نافذة القطعة (`offset..offset+batchSize`) للتشغيلة الفرعية. يرمي `ImportUnitFailureException` بالوحدات التي لم تُنتزع
     * (مطالَبة من تشغيلة أخرى أو ليست فاشلة) فتتراجع القطعة كلها.
     */
    public function claimWindow(ImportJob $child, string $path, string $extension, int $offset, int $batchSize): void
    {
        $all = $this->refsInFile($path, $extension, ProductImportService::DURABLE_MAX_ROWS);
        $window = array_slice($all, $offset, $batchSize, true);
        if ($window === []) {
            return;
        }

        $claimed = ImportJobUnit::query()
            ->where('import_job_id', $child->parent_job_id)
            ->whereIn('source_unit_ref', array_values($window))
            ->where('status', ImportJobUnit::FAILED)
            ->update(['status' => ImportJobUnit::REPAIRED, 'repaired_by_job_id' => $child->id, 'updated_at' => now()]);

        if ($claimed === count($window)) {
            return;
        }

        // بعض المعرّفات لم تُنتزع: نسمّيها (الباقي سليم لكن تراجعت نافذته معها).
        $stillClaimedByMe = ImportJobUnit::query()
            ->where('import_job_id', $child->parent_job_id)
            ->where('repaired_by_job_id', $child->id)
            ->whereIn('source_unit_ref', array_values($window))
            ->pluck('source_unit_ref')->all();
        $failures = [];
        foreach ($window as $ordinal => $ref) {
            if (! in_array($ref, $stillClaimedByMe, true)) {
                $failures[] = ['ordinal' => (int) $ordinal, 'code' => 'repair_ref_already_used', 'message' => 'أُصلحت هذه الوحدة بتشغيلة أخرى أو لم تعد قابلة للإصلاح.'];
            }
        }

        throw new ImportUnitFailureException('وحدات في هذه النافذة لم تعد قابلة للإصلاح (أُصلحت بتشغيلة أخرى).', $failures);
    }
}
