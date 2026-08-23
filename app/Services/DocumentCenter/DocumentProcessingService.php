<?php

namespace App\Services\DocumentCenter;

use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class DocumentProcessingService
{
    public const STAGE_SAFETY_SCAN = 'safety_scan';

    public function __construct(private readonly PlatformIntegrationResolver $settings)
    {
    }

    public function queueSafetyScans(DocumentBatch $batch): int
    {
        $dispatched = 0;
        $batch->files()
            ->where('scan_status', DocumentScanStatus::PENDING->value)
            ->orderBy('created_at')
            ->each(function (DocumentFile $file) use ($batch, &$dispatched): void {
                $run = DocumentProcessingRun::query()->firstOrCreate(
                    [
                        'document_file_id' => $file->id,
                        'stage' => self::STAGE_SAFETY_SCAN,
                    ],
                    [
                        'document_batch_id' => $batch->id,
                        'status' => DocumentProcessingStatus::QUEUED,
                        'queued_at' => now('UTC'),
                    ],
                );

                if (! $run->wasRecentlyCreated) {
                    return;
                }

                // HTTP must never execute malware scanning synchronously. In local/test
                // environments the run remains visible as queued until a real worker is used.
                if (config('queue.default') === 'sync') {
                    return;
                }

                $jobUuid = (string) Str::uuid();
                $run->fill(['job_uuid' => $jobUuid])->save();
                $policy = $this->settings->processingPolicy();
                ScanDocumentFile::dispatch(
                    $run->tenant_id,
                    $run->branch_id,
                    $run->id,
                    $file->id,
                    $jobUuid,
                    $policy['backoff_seconds'],
                    $policy['max_attempts'],
                    $policy['timeout_seconds'],
                )->onQueue('documents');
                $dispatched++;
            });

        return $dispatched;
    }

    public function claim(string $runId, string $jobUuid): ?DocumentProcessingRun
    {
        return DB::transaction(function () use ($runId, $jobUuid): ?DocumentProcessingRun {
            $run = DocumentProcessingRun::query()->whereKey($runId)->lockForUpdate()->firstOrFail();
            if (in_array($run->status, [DocumentProcessingStatus::SUCCEEDED, DocumentProcessingStatus::CANCELLED], true)) {
                return null;
            }
            if ($run->status === DocumentProcessingStatus::RUNNING
                && $run->started_at?->isAfter(now('UTC')->subMinutes(5))) {
                return null;
            }

            $run->fill([
                'status' => DocumentProcessingStatus::RUNNING,
                'attempt_count' => $run->attempt_count + 1,
                'job_uuid' => $jobUuid,
                'started_at' => now('UTC'),
                'finished_at' => null,
                'next_retry_at' => null,
                'error_code' => null,
                'error_message_safe' => null,
            ])->save();

            return $run->fresh();
        }, 3);
    }

    public function succeeded(DocumentProcessingRun $run): void
    {
        $this->finish($run, DocumentProcessingStatus::SUCCEEDED, null, null, null);
    }

    public function retry(DocumentProcessingRun $run, int $afterSeconds): void
    {
        $this->finish(
            $run,
            DocumentProcessingStatus::QUEUED,
            'scanner_unavailable',
            'تعذر إكمال الفحص الأمني؛ ستتم إعادة المحاولة.',
            now('UTC')->addSeconds($afterSeconds),
        );
    }

    public function failed(DocumentProcessingRun $run): void
    {
        $this->finish(
            $run,
            DocumentProcessingStatus::FAILED,
            'scanner_unavailable',
            'فشل الفحص الأمني بعد استنفاد المحاولات.',
            null,
        );
    }

    private function finish(
        DocumentProcessingRun $run,
        DocumentProcessingStatus $status,
        ?string $errorCode,
        ?string $safeMessage,
        ?\DateTimeInterface $nextRetry,
    ): void {
        DB::transaction(function () use ($run, $status, $errorCode, $safeMessage, $nextRetry): void {
            $locked = DocumentProcessingRun::query()->whereKey($run->id)->lockForUpdate()->firstOrFail();
            $locked->fill([
                'status' => $status,
                'error_code' => $errorCode,
                'error_message_safe' => $safeMessage,
                'next_retry_at' => $nextRetry,
                'finished_at' => $status === DocumentProcessingStatus::QUEUED ? null : now('UTC'),
            ])->save();
        }, 3);
    }
}
