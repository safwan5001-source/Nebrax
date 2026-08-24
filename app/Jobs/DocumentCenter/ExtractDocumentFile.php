<?php

namespace App\Jobs\DocumentCenter;

use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Services\DocumentCenter\DocumentExtractionService;
use App\Services\DocumentCenter\DocumentProcessingService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

class ExtractDocumentFile implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 210;

    public int $uniqueFor = 900;

    public bool $failOnTimeout = true;

    public function __construct(
        public readonly string $tenantId,
        public readonly string $branchId,
        public readonly string $processingRunId,
        public readonly string $documentFileId,
        public readonly string $jobUuid,
    ) {
    }

    public function uniqueId(): string
    {
        return "document-extraction:{$this->tenantId}:{$this->branchId}:{$this->documentFileId}";
    }

    public function handle(
        TenantContext $tenant,
        BranchContext $branch,
        DocumentProcessingService $processing,
        DocumentExtractionService $extraction,
    ): void {
        $tenant->forget();
        $branch->forget();

        try {
            $tenant->set($this->tenantId);
            $branch->set($this->branchId);
            $run = $processing->claim($this->processingRunId, $this->jobUuid);
            if ($run === null) {
                return;
            }
            $file = DocumentFile::query()->whereKey($this->documentFileId)->firstOrFail();
            $extraction->process($run, $file);
        } catch (Throwable $exception) {
            $run = DocumentProcessingRun::query()->whereKey($this->processingRunId)->first();
            if ($run !== null) {
                $processing->failedExtraction($run, 'extraction_worker_failed', 'تعذر إكمال عامل استخراج المستند.');
            }
            $this->fail($exception);
        } finally {
            $branch->forget();
            $tenant->forget();
        }
    }
}
