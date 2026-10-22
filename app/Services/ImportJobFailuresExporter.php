<?php

namespace App\Services;

use App\Contracts\ImportDomainAdapter;
use App\Contracts\ImportFailureExportAdapter;
use App\Models\ImportJob;
use App\Models\ImportJobUnit;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use RuntimeException;

/**
 * ملف الصفوف الفاشلة لتشغيلة (IMP-H1-S8a): ترويسات الملف الأصلي + صفوفه الفاشلة فقط بقيمها الأصلية، يضاف إليها ثلاثة أعمدة محمية:
 * `_awj_unit_ref` (معرّف المصدر الثابت — أساس الإصلاح S8b)، `_awj_error_code`، `_awj_error`، و`_awj_redacted` (أسماء الأعمدة المحجوبة).
 *
 * **حجب الحسّاس:** أعمدة يعلنها المحوّل (`ImportFailureExportAdapter`) تُفرَّغ لمن لا يملك صلاحية الحقل (التكلفة اليوم) ويُسمّى العمود في
 * `_awj_redacted`. محوّلٌ لا يعلن أعمدته الحسّاسة لا يُصدَّر له ملف (فشلٌ مغلق).
 *
 * الكتابة عبر `SpreadsheetWriter` (CSV يسبق قيمَ المشغّلات `=+-@` بعلامة اقتباس: حماية من حقن الصيغ — وهي نفسها قاعدة ملفات التصدير القائمة).
 */
class ImportJobFailuresExporter
{
    public const COLUMN_REF = '_awj_unit_ref';

    public const COLUMN_CODE = '_awj_error_code';

    public const COLUMN_ERROR = '_awj_error';

    public const COLUMN_REDACTED = '_awj_redacted';

    public function __construct(
        private readonly ImportJobFileStorage $storage,
        private readonly ImportDomainRegistry $domains,
    ) {}

    /**
     * @return array{path: string, filename: string, mime: string} ملفٌّ مؤقت يحذفه المستدعي بعد الإرسال
     */
    public function export(ImportJob $job, bool $costAuthorized, string $format): array
    {
        if (! in_array($format, ['csv', 'xlsx'], true)) {
            throw new RuntimeException('صيغة الملف غير مدعومة. استخدم CSV أو XLSX.');
        }
        $adapter = $this->domains->for($job->domain);
        if ($adapter->unit() !== ImportDomainAdapter::UNIT_ROW || ! $adapter instanceof ImportFailureExportAdapter) {
            throw new RuntimeException('هذا المجال لا يدعم تنزيل الصفوف الفاشلة (وحدته ذرّية: صحّح الملف وأعد رفعه).');
        }

        /** @var array<int, ImportJobUnit> $units */
        $units = ImportJobUnit::query()
            ->where('import_job_id', $job->id)
            ->where('status', ImportJobUnit::FAILED)
            ->orderBy('unit_ordinal')
            ->get()
            ->keyBy('unit_ordinal')
            ->all();
        if ($units === []) {
            throw new RuntimeException('لا صفوف فاشلة لهذه التشغيلة.');
        }

        $tmp = $this->materialize((string) $job->storage_path);
        try {
            $table = SpreadsheetReader::read($tmp, (string) $job->extension, $adapter->maxRows(), ProductImportService::MAX_COLUMNS);
        } finally {
            @unlink($tmp);
        }
        if ($table === []) {
            throw new RuntimeException('الملف الأصلي فارغ.');
        }

        $headers = array_map('strval', $table[0]);
        $hidden = $costAuthorized ? [] : array_flip($adapter->sensitiveColumnIndexes($headers, (array) $job->apply_options));
        $redactedNames = array_values(array_map(static fn (int $i): string => $headers[$i] ?? '', array_keys($hidden)));

        $out = [];
        $ordinal = -1;
        foreach (array_slice($table, 1) as $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $ordinal++;
            if (! isset($units[$ordinal])) {
                continue;
            }
            $cells = [];
            foreach (array_keys($headers) as $i) {
                $cells[] = isset($hidden[$i]) ? '' : (string) ($values[$i] ?? '');
            }
            $unit = $units[$ordinal];
            $out[] = array_merge($cells, [$unit->source_unit_ref, $unit->error_code, (string) $unit->error_message, implode(' | ', $redactedNames)]);
        }

        $header = array_merge($headers, [self::COLUMN_REF, self::COLUMN_CODE, self::COLUMN_ERROR, self::COLUMN_REDACTED]);
        $base = pathinfo((string) $job->original_filename, PATHINFO_FILENAME) ?: 'import';
        $path = (string) tempnam(sys_get_temp_dir(), 'import-failures-');

        if ($format === 'xlsx') {
            SpreadsheetWriter::xlsx($path, $header, $out, array_fill(0, count($header), SpreadsheetWriter::TYPE_TEXT));
        } else {
            file_put_contents($path, SpreadsheetWriter::csv($header, $out));
        }

        return [
            'path' => $path,
            'filename' => "failures-{$base}.{$format}",
            'mime' => $format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=UTF-8',
        ];
    }

    private function materialize(string $storagePath): string
    {
        $stream = $this->storage->readStream($storagePath);
        $tmp = tempnam(sys_get_temp_dir(), 'import-failures-src-');
        $target = $tmp === false ? false : fopen($tmp, 'wb');
        if (! is_resource($target)) {
            throw new RuntimeException('تعذّر إنشاء نسخة مؤقتة للملف الأصلي.');
        }
        stream_copy_to_stream($stream, $target);
        fclose($target);
        if (is_resource($stream)) {
            fclose($stream);
        }

        return (string) $tmp;
    }
}
