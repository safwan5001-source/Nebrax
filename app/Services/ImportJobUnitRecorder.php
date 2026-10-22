<?php

namespace App\Services;

use App\Contracts\ImportDomainAdapter;
use App\Models\ImportJob;
use App\Models\ImportJobUnit;
use App\Support\ImportPreviewException;
use App\Support\ImportUnitFailureException;
use App\Support\ImportUnitRef;
use Illuminate\Support\Str;
use Throwable;

/**
 * يسجّل الوحدات الفاشلة/غير المنجزة لقطعةٍ فشلت (IMP-H1-S8a) — **داخل معاملة فشل التشغيلة نفسها** فلا حالة `failed` بلا وحداتها.
 *
 * لا يسجّل إلا لمجالات **وحدتها الصفّ** (`UNIT_ROW`): قطعتها تفشل كاملةً وتتراجع، فما بعد `processed_rows` كله غير منجز. المجالات ذات
 * الملف/المستند كوحدة ذرّية تفشل كاملةً بلا حالة جزئية، فلا إصلاح جزئي لها (تُصحَّح وتُرفع من جديد) — كل مجالٍ لاحق من نوع المستند يضيف
 * اختبار إصلاحه.
 *
 * التصنيف (كلها `failed` وكلها قابلة للإصلاح):
 *  - وحداتٌ بعينها سمّاها الاستثناء (`ImportUnitFailureException`) برمزها ورسالتها؛
 *  - بقية نافذة القطعة: `window_rolled_back` (تراجعت مع نافذتها وليست سبب الفشل)؛
 *  - ما بعد النافذة: `not_attempted`؛
 *  - فشلٌ بلا تسمية وحدات (مثل `plan_drift` أو خطأ كتابة): النافذة كلها بالرمز الأخصّ (`plan_drift` أو `chunk_failed`).
 */
class ImportJobUnitRecorder
{
    private const INSERT_CHUNK = 500;

    private const MESSAGE_LIMIT = 1000;

    public function recordChunkFailure(ImportJob $job, ImportDomainAdapter $adapter, int $offset, int $batchSize, Throwable $e): void
    {
        if ($adapter->unit() !== ImportDomainAdapter::UNIT_ROW) {
            return;
        }

        $total = (int) $job->row_count;
        $windowEnd = min($offset + $batchSize, $total);
        if ($offset >= $total) {
            return;
        }

        /** @var array<int, array{code: string, message: string}> $byOrdinal */
        $byOrdinal = [];
        if ($e instanceof ImportUnitFailureException) {
            foreach ($e->failures as $failure) {
                if ($failure['ordinal'] >= $offset && $failure['ordinal'] < $windowEnd) {
                    $byOrdinal[$failure['ordinal']] = ['code' => $failure['code'], 'message' => $failure['message']];
                }
            }
        }

        $windowCode = $e instanceof ImportPreviewException ? $e->reason : 'chunk_failed';
        $rows = [];
        for ($ordinal = $offset; $ordinal < $total; $ordinal++) {
            if ($ordinal < $windowEnd) {
                $entry = $byOrdinal[$ordinal] ?? ($byOrdinal === []
                    ? ['code' => $windowCode, 'message' => $e->getMessage()]
                    : ['code' => 'window_rolled_back', 'message' => 'لم تُطبَّق لأن نافذتها فشلت وتراجعت كاملةً.']);
            } else {
                $entry = ['code' => 'not_attempted', 'message' => 'لم تُعالَج بعد: توقّفت التشغيلة قبل الوصول إليها.'];
            }
            $rows[] = $this->row($job, $ordinal, $entry);
            if (count($rows) >= self::INSERT_CHUNK) {
                ImportJobUnit::query()->insert($rows);
                $rows = [];
            }
        }
        if ($rows !== []) {
            ImportJobUnit::query()->insert($rows);
        }
    }

    /** @param array{code: string, message: string} $entry @return array<string, mixed> */
    private function row(ImportJob $job, int $ordinal, array $entry): array
    {
        $now = now();

        return [
            'id' => (string) Str::uuid(),
            'tenant_id' => $job->tenant_id,
            'import_job_id' => $job->id,
            'source_unit_ref' => ImportUnitRef::for($job->id, $ordinal),
            'unit_ordinal' => $ordinal,
            'status' => ImportJobUnit::FAILED,
            'error_code' => $entry['code'],
            'error_message' => mb_substr($entry['message'], 0, self::MESSAGE_LIMIT),
            'repaired_by_job_id' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ];
    }
}
