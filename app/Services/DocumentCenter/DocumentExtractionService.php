<?php

namespace App\Services\DocumentCenter;

use App\Jobs\DocumentCenter\ExtractDocumentFile;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentProviderAttempt;
use App\Models\DocumentProviderUsageEvent;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class DocumentExtractionService
{
    public const STAGE_EXTRACTION = 'extraction';

    public function __construct(
        private readonly PlatformIntegrationResolver $settings,
        private readonly DocumentExtractionProviderRegistry $providers,
        private readonly DocumentStorageService $storage,
        private readonly DocumentProcessingService $processing,
        private readonly DocumentWorkflowService $workflow,
    ) {
    }

    public function queueExtractions(DocumentBatch $batch): int
    {
        $policy = $this->settings->documentExtractionPolicy();
        if (! $policy->enabled() || ! DocumentProviderNetworkGate::allowsExternalRequests()) {
            return 0;
        }
        $synchronous = $this->settings->documentProcessingMode() === DocumentExtractionPolicy::MODE_SYNC;
        if (! $synchronous && config('queue.default') === 'sync') {
            return 0;
        }
        // بوّابة المستأجر (PR #630): لا يُرسَل مستند إلى المزود ما لم يُفعّل المستأجر
        // المعالجة الذكية ويُدرج نوعه ضمن المسموح. المستند يبقى في المركز متاحاً.
        if (! $this->tenantAllowsExtraction($batch)) {
            return 0;
        }

        $files = $batch->files()->orderBy('created_at')->get();
        if ($files->isEmpty() || ! $policy->allowsBatchFileCount($files->count())) {
            return 0;
        }
        if ($files->contains(fn (DocumentFile $file): bool => $file->scan_status !== DocumentScanStatus::CLEAN)) {
            return 0;
        }
        if (! $this->hasReadyPrimaryProvider($policy)) {
            return 0;
        }

        $created = [];
        foreach ($files as $file) {
            if (! $policy->allowsFile($file->size_bytes, $file->page_count)) {
                return 0;
            }
            $run = DocumentProcessingRun::query()->firstOrCreate(
                ['document_file_id' => $file->id, 'stage' => self::STAGE_EXTRACTION],
                [
                    'document_batch_id' => $batch->id,
                    'status' => DocumentProcessingStatus::QUEUED,
                    'queued_at' => now('UTC'),
                ],
            );
            if ($run->wasRecentlyCreated) {
                $created[] = [$run, $file];
            }
        }

        if ($created === []) {
            return 0;
        }

        if ($batch->status === DocumentWorkflowStatus::RECEIVED) {
            $this->workflow->transition(
                $batch,
                DocumentWorkflowStatus::QUEUED,
                'extraction_queued',
                'system',
                null,
                null,
                ['stage' => self::STAGE_EXTRACTION, 'file_count' => count($created)],
            );
        }

        foreach ($created as [$run, $file]) {
            $jobUuid = (string) Str::uuid();
            $run->fill(['job_uuid' => $jobUuid])->save();
            if ($synchronous) {
                $this->executeSynchronously($run, $file, $jobUuid);
            } else {
                ExtractDocumentFile::dispatch($run->tenant_id, $run->branch_id, $run->id, $file->id, $jobUuid)
                    ->onQueue('documents');
            }
        }

        return count($created);
    }

    public function executeSynchronously(DocumentProcessingRun $run, DocumentFile $file, string $jobUuid): void
    {
        $claimed = $this->processing->claim($run->id, $jobUuid);
        if ($claimed === null) {
            return;
        }

        try {
            $this->process($claimed, $file, 1);
        } catch (Throwable) {
            $this->processing->failedExtraction($claimed, 'extraction_worker_failed', 'تعذر إكمال عامل استخراج المستند.');
        }
    }

    public function process(DocumentProcessingRun $run, DocumentFile $file, ?int $maxProviderAttemptsThisInvocation = null): void
    {
        $policy = $this->settings->documentExtractionPolicy();
        // إعادة فحص بوّابة المستأجر داخل العامل: قد يُعطِّل المستأجر المعالجة أو
        // يزيل النوع بين لحظة الجدولة والتشغيل، فنفشل بأمان بلا أي استدعاء للمزود.
        if (! $policy->enabled() || ! DocumentProviderNetworkGate::allowsExternalRequests() || ! $this->tenantAllowsExtraction($run->batch) || $file->scan_status !== DocumentScanStatus::CLEAN || $file->purged_at !== null) {
            $this->failRun($run, 'extraction_not_permitted', 'لم يعد الاستخراج مسموحاً وفق سياسة المنصة أو المستأجر أو حالة الملف.');

            return;
        }
        if (! $policy->allowsFile($file->size_bytes, $file->page_count)) {
            $this->failRun($run, 'extraction_file_limit', 'يتجاوز الملف حدود سياسة الاستخراج المسموح بها.');

            return;
        }

        $this->moveBatchToProcessing($run->batch);
        $base64 = $this->base64File($file);
        $sequence = (int) DocumentProviderAttempt::query()
            ->where('document_processing_run_id', $run->id)
            ->max('sequence');

        foreach ($policy->orderedProviders() as $providerKey) {
            $configuration = $policy->provider($providerKey);
            if (! $configuration->isOperationallyReady()) {
                continue;
            }
            if (! $this->withinUsageLimit($providerKey, $configuration, $file->page_count)) {
                $this->recordSkippedAttempt($run, $file, ++$sequence, $configuration, 'usage_limit_reached', 'بلغ المزود حد الاستخدام الشهري المسموح به.');
                continue;
            }

            $provider = $this->providers->resolve($providerKey);
            $validation = $provider->validateConfiguration($configuration);
            if (! $validation->valid) {
                $this->recordSkippedAttempt($run, $file, ++$sequence, $configuration, 'provider_not_configured', $validation->errors[0]);
                continue;
            }

            $configuredAttempts = max(1, $configuration->maxAttempts);
            $attemptBudget = $maxProviderAttemptsThisInvocation === null
                ? $configuredAttempts
                : max(1, min($configuredAttempts, $maxProviderAttemptsThisInvocation));
            for ($attemptNumber = 1; $attemptNumber <= $attemptBudget; $attemptNumber++) {
                $attempt = DocumentProviderAttempt::create([
                    'document_batch_id' => $run->document_batch_id,
                    'document_file_id' => $file->id,
                    'document_processing_run_id' => $run->id,
                    'sequence' => ++$sequence,
                    'provider_key' => $providerKey,
                    'model' => $configuration->model,
                    'status' => 'started',
                    'page_count' => $file->page_count,
                    'started_at' => now('UTC'),
                ]);

                try {
                    $result = $provider->extract(new DocumentExtractionRequest(
                        $providerKey,
                        $configuration,
                        $file->original_name,
                        $file->detected_mime,
                        $base64,
                        $file->page_count,
                        (string) $run->batch->document_type,
                        $policy->defaultLanguage(),
                    ));
                    $finishedAt = now('UTC');
                    $attempt->fill([
                        'status' => 'succeeded',
                        'input_tokens' => $result->inputTokens,
                        'output_tokens' => $result->outputTokens,
                        'processing_duration_ms' => $this->durationMilliseconds($attempt, $finishedAt),
                        'finished_at' => $finishedAt,
                    ])->save();
                    $this->recordSuccess($run, $file, $attempt, $result);
                    $this->processing->succeeded($run);
                    $this->completeBatchIfReady($run->batch);

                    return;
                } catch (DocumentProviderException $exception) {
                    $attempt->fill([
                        'status' => 'failed',
                        'error_code' => $exception->safeCode,
                        'error_message_safe' => $exception->safeMessage,
                        'finished_at' => now('UTC'),
                    ])->save();
                    if (! $exception->retryable) {
                        break;
                    }
                } catch (Throwable) {
                    $attempt->fill([
                        'status' => 'failed',
                        'error_code' => 'provider_unavailable',
                        'error_message_safe' => 'تعذر الوصول إلى مزود الاستخراج لإكمال المحاولة.',
                        'finished_at' => now('UTC'),
                    ])->save();
                }
            }
        }

        $this->failRun($run, 'extraction_failed', 'فشل الاستخراج بعد استنفاد المزودين والمحاولات المسموح بها.');
    }

    /**
     * بوّابة المستأجر المستقلّة (PR #630): تفعيل المعالجة الذكية **و** إدراج نوع
     * المستند ضمن الأنواع المسموح بها. مستقلّة تماماً عن سياسة المنصة (المحرك
     * والشبكة والمزود) وعن سياسة الاحتفاظ بالأصل — تفعيل الذكاء لا يمسّ الاحتفاظ.
     */
    private function tenantAllowsExtraction(DocumentBatch $batch): bool
    {
        return DocumentIntelligencePolicy::forTenant()->shouldProcessDocumentType((string) $batch->document_type);
    }

    private function hasReadyPrimaryProvider(DocumentExtractionPolicy $policy): bool
    {
        $primary = $policy->primaryProvider();
        if ($primary === null) {
            return false;
        }

        try {
            return $policy->provider($primary)->isOperationallyReady() && in_array($primary, $this->providers->keys(), true);
        } catch (Throwable) {
            return false;
        }
    }

    private function moveBatchToProcessing(DocumentBatch $batch): void
    {
        $fresh = DocumentBatch::query()->findOrFail($batch->id);
        if ($fresh->status === DocumentWorkflowStatus::QUEUED) {
            $this->workflow->transition(
                $fresh,
                DocumentWorkflowStatus::PROCESSING,
                'extraction_started',
                'system',
                null,
                null,
                ['stage' => self::STAGE_EXTRACTION],
            );
        }
    }

    private function completeBatchIfReady(DocumentBatch $batch): void
    {
        $runs = DocumentProcessingRun::query()
            ->where('document_batch_id', $batch->id)
            ->where('stage', self::STAGE_EXTRACTION)
            ->get();
        if ($runs->isEmpty() || $runs->contains(fn (DocumentProcessingRun $run): bool => $run->status !== DocumentProcessingStatus::SUCCEEDED)) {
            return;
        }

        $fresh = DocumentBatch::query()->findOrFail($batch->id);
        if ($fresh->status === DocumentWorkflowStatus::PROCESSING) {
            $this->workflow->transition(
                $fresh,
                DocumentWorkflowStatus::NEEDS_REVIEW,
                'extraction_completed',
                'system',
                null,
                null,
                ['stage' => self::STAGE_EXTRACTION, 'file_count' => $runs->count()],
            );
        }
    }

    private function failRun(DocumentProcessingRun $run, string $code, string $message): void
    {
        $this->processing->failedExtraction($run, $code, $message);
        $fresh = DocumentBatch::query()->findOrFail($run->document_batch_id);
        if (in_array($fresh->status, [DocumentWorkflowStatus::QUEUED, DocumentWorkflowStatus::PROCESSING], true)) {
            $this->workflow->transition(
                $fresh,
                DocumentWorkflowStatus::FAILED,
                'extraction_failed',
                'system',
                null,
                $message,
                ['stage' => self::STAGE_EXTRACTION, 'error_code' => $code],
            );
        }
    }

    private function base64File(DocumentFile $file): string
    {
        $stream = $this->storage->readStream($file->storage_profile, $file->object_key);
        try {
            $contents = stream_get_contents($stream);
            if (! is_string($contents)) {
                throw new DocumentProviderException('file_read_failed', 'تعذر قراءة الملف الخاص للاستخراج.', false);
            }

            return base64_encode($contents);
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }
    }

    private function withinUsageLimit(string $providerKey, DocumentProviderConfiguration $configuration, int $pageCount): bool
    {
        if ($configuration->monthlyOperationLimit === null && $configuration->monthlyPageLimit === null) {
            return true;
        }

        $usage = DocumentProviderUsageEvent::query()
            ->where('provider_key', $providerKey)
            ->where('occurred_at', '>=', now('UTC')->startOfMonth())
            ->selectRaw('COUNT(*) as operations, COALESCE(SUM(page_count), 0) as pages')
            ->first();
        $operations = (int) ($usage?->operations ?? 0);
        $pages = (int) ($usage?->pages ?? 0);

        return ($configuration->monthlyOperationLimit === null || $operations < $configuration->monthlyOperationLimit)
            && ($configuration->monthlyPageLimit === null || $pages + $pageCount <= $configuration->monthlyPageLimit);
    }

    private function recordSkippedAttempt(
        DocumentProcessingRun $run,
        DocumentFile $file,
        int $sequence,
        DocumentProviderConfiguration $configuration,
        string $code,
        string $message,
    ): void {
        DocumentProviderAttempt::create([
            'document_batch_id' => $run->document_batch_id,
            'document_file_id' => $file->id,
            'document_processing_run_id' => $run->id,
            'sequence' => $sequence,
            'provider_key' => $configuration->key,
            'model' => $configuration->model === '' ? 'not-configured' : $configuration->model,
            'status' => 'skipped',
            'error_code' => $code,
            'error_message_safe' => $message,
            'page_count' => $file->page_count,
            'started_at' => now('UTC'),
            'finished_at' => now('UTC'),
        ]);
    }

    private function durationMilliseconds(DocumentProviderAttempt $attempt, \DateTimeInterface $finishedAt): ?int
    {
        return $attempt->started_at === null ? null : max(0, $attempt->started_at->diffInMilliseconds($finishedAt));
    }

    private function recordSuccess(
        DocumentProcessingRun $run,
        DocumentFile $file,
        DocumentProviderAttempt $attempt,
        ProviderExtractionResult $providerResult,
    ): void {
        $payload = $providerResult->payload;
        DB::transaction(function () use ($run, $file, $attempt, $payload, $providerResult): void {
            DocumentExtractionResult::create([
                'document_batch_id' => $run->document_batch_id,
                'document_file_id' => $file->id,
                'document_processing_run_id' => $run->id,
                'document_provider_attempt_id' => $attempt->id,
                'provider_key' => $attempt->provider_key,
                'model' => $attempt->model,
                'schema_version' => DocumentExtractionNormalizer::SCHEMA_VERSION,
                'detected_document_type' => $payload['document_type'],
                'detected_language' => $payload['language'],
                'confidence_basis_points' => $payload['confidence_basis_points'],
                'normalized_payload' => $payload,
                'extracted_at' => now('UTC'),
            ]);
            DocumentProviderUsageEvent::create([
                'document_provider_attempt_id' => $attempt->id,
                'document_batch_id' => $run->document_batch_id,
                'provider_key' => $attempt->provider_key,
                'model' => $attempt->model,
                'provider_event_key' => "attempt:{$attempt->id}",
                'page_count' => $file->page_count,
                'input_tokens' => $providerResult->inputTokens,
                'output_tokens' => $providerResult->outputTokens,
                'processing_duration_ms' => $attempt->processing_duration_ms,
                'currency' => null,
                'cost_minor' => null,
                'cost_policy_version' => null,
                'occurred_at' => now('UTC'),
            ]);
        }, 3);
    }
}
