<?php

namespace App\Jobs\DocumentCenter;

use App\Contracts\DocumentSafetyScanner;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Services\DocumentCenter\DocumentExtractionService;
use App\Services\DocumentCenter\DocumentFileScanService;
use App\Services\DocumentCenter\DocumentProcessingService;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentScanStatus;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

class ScanDocumentFile implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;

    public int $timeout = 150;

    public int $uniqueFor = 900;

    public bool $failOnTimeout = true;

    public function __construct(
        public readonly string $tenantId,
        public readonly string $branchId,
        public readonly string $processingRunId,
        public readonly string $documentFileId,
        public readonly string $jobUuid,
        public readonly array $retryBackoff,
        int $maximumAttempts,
        int $timeoutSeconds,
    ) {
        $this->tries = $maximumAttempts;
        $this->timeout = $timeoutSeconds;
    }

    public function uniqueId(): string
    {
        return "document-safety-scan:{$this->tenantId}:{$this->branchId}:{$this->documentFileId}";
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return $this->retryBackoff;
    }

    public function handle(
        TenantContext $tenant,
        BranchContext $branch,
        DocumentProcessingService $processing,
        DocumentStorageService $storage,
        DocumentSafetyScanner $scanner,
        DocumentFileScanService $scanDecisions,
        PlatformIntegrationResolver $settings,
        ?DocumentExtractionService $extraction = null,
    ): void {
        $tenant->forget();
        $branch->forget();

        try {
            $tenant->set($this->tenantId);
            $branch->set($this->branchId);
            $run = $processing->claim($this->processingRunId, $this->jobUuid);
            if (! $run) {
                return;
            }

            $file = DocumentFile::query()->whereKey($this->documentFileId)->firstOrFail();
            $stream = $storage->readStream($file->storage_profile, $file->object_key);
            try {
                $decision = $scanner->scan($stream);
            } finally {
                fclose($stream);
            }

            $scannedFile = $scanDecisions->record($file, $decision, $scanner->providerName());
            if ($decision === DocumentScanStatus::CLEAN && $extraction !== null) {
                $extraction->queueExtractions($scannedFile->batch);
            }
            $processing->succeeded($run);
        } catch (Throwable $exception) {
            $run = DocumentProcessingRun::query()->whereKey($this->processingRunId)->first();
            if (! $run) {
                throw $exception;
            }

            $policy = $settings->processingPolicy();
            $attempt = max($run->attempt_count, $this->attemptNumber());
            if ($attempt >= $policy['max_attempts']) {
                $processing->failed($run);
                $file = DocumentFile::query()->whereKey($this->documentFileId)->first();
                if ($file && $file->scan_status === DocumentScanStatus::PENDING) {
                    $scanDecisions->record($file, DocumentScanStatus::FAILED, $scanner->providerName());
                }
                $this->fail($exception);

                return;
            }

            $backoff = $policy['backoff_seconds'];
            $processing->retry($run, $backoff[min($attempt - 1, count($backoff) - 1)]);
            throw $exception;
        } finally {
            $branch->forget();
            $tenant->forget();
        }
    }

    private function attemptNumber(): int
    {
        return $this->job ? max(1, $this->job->attempts()) : 1;
    }
}
