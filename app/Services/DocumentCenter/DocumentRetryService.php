<?php

namespace App\Services\DocumentCenter;

use App\Jobs\DocumentCenter\ExtractDocumentFile;
use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\DocumentFile;
use App\Models\DocumentGovernanceEvent;
use App\Models\DocumentProcessingRun;
use App\Models\User;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Retry تشغيلي فقط؛ لا يعيد review/draft/transaction/posting أو receipt replay. */
final class DocumentRetryService
{
    public const CODE_NOT_ALLOWED = 'document_retry_not_allowed';

    public const CODE_RUNTIME_UNAVAILABLE = 'document_retry_runtime_unavailable';

    public const CODE_LIMIT_REACHED = 'document_retry_limit_reached';

    public const CODE_ALREADY_ACTIVE = 'document_retry_already_active';

    public const CODE_FILE_UNAVAILABLE = 'document_retry_file_unavailable';

    public const CODE_NETWORK_LOCKED = 'document_retry_network_locked';

    public const CODE_STALE_VERSION = 'document_retry_stale_version';

    public const CODE_DISPATCH_FAILED = 'document_retry_dispatch_failed';

    public function __construct(
        private readonly PlatformIntegrationResolver $settings,
        private readonly DocumentStorageService $storage,
        private readonly DocumentWorkflowService $workflow,
        private readonly DocumentFileScanAdmissionService $scanAdmission,
    ) {}

    /** @return array{accepted:bool,code:?string,message:string,run:DocumentProcessingRun} */
    public function retry(DocumentProcessingRun $run, ?User $actor, ?string $version = null): array
    {
        $result = DB::transaction(function () use ($run, $actor, $version): array {
            $locked = DocumentProcessingRun::query()->whereKey($run->id)->lockForUpdate()->firstOrFail();
            $file = $locked->file()->firstOrFail();
            $batch = $locked->batch()->firstOrFail();

            if ($version !== null && $locked->updated_at?->toIso8601String() !== $version) {
                return $this->rejected($locked, $actor, self::CODE_STALE_VERSION, 'تغيرت حالة المعالجة؛ حدّث الصفحة قبل إعادة المحاولة.');
            }
            if (! in_array($locked->stage, [DocumentProcessingService::STAGE_SAFETY_SCAN, DocumentExtractionService::STAGE_EXTRACTION], true)
                || $locked->status !== DocumentProcessingStatus::FAILED) {
                $code = in_array($locked->status, [DocumentProcessingStatus::QUEUED, DocumentProcessingStatus::RUNNING], true)
                    ? self::CODE_ALREADY_ACTIVE : self::CODE_NOT_ALLOWED;

                return $this->rejected($locked, $actor, $code, 'لا تسمح حالة المعالجة الحالية بإعادة المحاولة.');
            }
            if ($file->purged_at !== null || ! $this->stored($file)) {
                return $this->rejected($locked, $actor, self::CODE_FILE_UNAVAILABLE, 'ملف المستند غير متاح لإعادة المحاولة.');
            }
            // حد إعادة المحاولة اليدوية مستقلّ تماماً عن ميزانية محاولات المزوّد داخل الدورة
            // الواحدة (max_attempts). كل دورة (أصلية أو retry مقبول) تحصل على ميزانيتها
            // الخاصة من جديد — انظر إعادة ضبط attempt_count أدناه عند القبول. المُشتقّ هنا
            // هو عدد دورات retry المقبولة سابقاً لنفس الـ run، من سجل الحوكمة الدائم.
            $manualRetryCycles = $this->manualRetryCycleCount($locked);
            if ($manualRetryCycles >= $this->manualRetryCycleLimit()) {
                return $this->rejected($locked, $actor, self::CODE_LIMIT_REACHED, 'تم بلوغ الحد الآمن لعدد مرات إعادة المحاولة اليدوية لهذه المعالجة.');
            }
            if ($locked->stage === DocumentProcessingService::STAGE_SAFETY_SCAN) {
                $synchronous = $this->settings->documentProcessingMode() === DocumentExtractionPolicy::MODE_SYNC;
                if ((! $synchronous && config('queue.default') === 'sync')
                    || $this->settings->documentProcessingIsAuthoritativelyDisabled()
                    || $this->settings->activeConfiguration('malware_scanner') === []) {
                    return $this->rejected($locked, $actor, self::CODE_RUNTIME_UNAVAILABLE, 'الفحص الأمني غير مفعّل حالياً.');
                }
            }
            if ($locked->stage === DocumentExtractionService::STAGE_EXTRACTION) {
                if (! DocumentProviderNetworkGate::allowsExternalRequests()) {
                    return $this->rejected($locked, $actor, self::CODE_NETWORK_LOCKED, 'استخراج البيانات غير مفعّل حالياً.');
                }
                $policy = $this->settings->documentExtractionPolicy();
                $primary = $policy->primaryProvider();
                $configuration = $primary === null ? null : $policy->provider($primary);
                $synchronous = $this->settings->documentProcessingMode() === DocumentExtractionPolicy::MODE_SYNC;
                if ((! $synchronous && config('queue.default') === 'sync') || ! $policy->enabled() || $configuration === null || ! $configuration->isOperationallyReady()) {
                    return $this->rejected($locked, $actor, self::CODE_RUNTIME_UNAVAILABLE, 'استخراج البيانات غير مفعّل حالياً.');
                }
                if (! $this->scanAdmission->authorize($file) || $batch->status === DocumentWorkflowStatus::QUARANTINED || ! $policy->allowsFile($file->size_bytes, $file->page_count)) {
                    return $this->rejected($locked, $actor, self::CODE_NOT_ALLOWED, 'حالة الملف أو المستند لا تسمح بإعادة الاستخراج.');
                }
            }

            $jobUuid = (string) Str::uuid();
            $locked->fill([
                'status' => DocumentProcessingStatus::QUEUED,
                // دورة معالجة جديدة تبدأ بميزانية محاولات مزوّد خاصة بها من الصفر —
                // كل البوّابات أعلاه اجتازت بالفعل قبل هذا السطر (لا إعادة ضبط لطلب مرفوض).
                'attempt_count' => 0,
                'job_uuid' => $jobUuid,
                'queued_at' => now('UTC'),
                'started_at' => null,
                'finished_at' => null,
                'next_retry_at' => null,
                'error_code' => null,
                'error_message_safe' => null,
            ])->save();
            $fresh = $locked->fresh();
            $this->event($fresh, $actor, DocumentGovernanceEvent::ACTION_RETRY_QUEUED, null, [
                'retry_sequence' => $manualRetryCycles + 1,
            ]);

            return ['accepted' => true, 'code' => null, 'message' => 'تمت جدولة إعادة المحاولة.', 'run' => $fresh];
        }, 3);

        if (! $result['accepted']) {
            return $result;
        }

        $fresh = $result['run'];
        if ($fresh->stage === DocumentExtractionService::STAGE_EXTRACTION) {
            $batch = $fresh->batch()->firstOrFail();
            if ($batch->status === DocumentWorkflowStatus::FAILED) {
                $this->workflow->transition($batch, DocumentWorkflowStatus::QUEUED, 'extraction_retry_queued', 'user', $actor?->id, null, ['stage' => $fresh->stage]);
            }
        }

        if ($this->settings->documentProcessingMode() === DocumentExtractionPolicy::MODE_SYNC) {
            if ($fresh->stage === DocumentExtractionService::STAGE_EXTRACTION) {
                app(DocumentExtractionService::class)->executeSynchronously($fresh, $fresh->file()->firstOrFail(), (string) $fresh->job_uuid);
            } else {
                app(DocumentProcessingService::class)->executeSafetyScanSynchronously($fresh, $fresh->file()->firstOrFail(), (string) $fresh->job_uuid);
            }

            return [
                'accepted' => true,
                'code' => null,
                'message' => 'تمت إعادة المحاولة.',
                'run' => $fresh->fresh(),
            ];
        }

        try {
            if ($fresh->stage === DocumentExtractionService::STAGE_EXTRACTION) {
                ExtractDocumentFile::dispatch($fresh->tenant_id, $fresh->branch_id, $fresh->id, $fresh->document_file_id, $fresh->job_uuid)->onQueue('documents');
            } else {
                $policy = $this->settings->processingPolicy();
                ScanDocumentFile::dispatch($fresh->tenant_id, $fresh->branch_id, $fresh->id, $fresh->document_file_id, $fresh->job_uuid, $policy['backoff_seconds'], $policy['max_attempts'], $policy['timeout_seconds'])->onQueue('documents');
            }
        } catch (\Throwable) {
            return $this->dispatchFailed($fresh, $actor);
        }

        return $result;
    }

    /** @return array{accepted:false,code:string,message:string,run:DocumentProcessingRun} */
    private function dispatchFailed(DocumentProcessingRun $run, ?User $actor): array
    {
        $failed = DB::transaction(function () use ($run, $actor): DocumentProcessingRun {
            $locked = DocumentProcessingRun::query()->whereKey($run->id)->lockForUpdate()->firstOrFail();
            if ($locked->status === DocumentProcessingStatus::QUEUED && $locked->job_uuid === $run->job_uuid) {
                $locked->fill([
                    'status' => DocumentProcessingStatus::FAILED,
                    'finished_at' => now('UTC'),
                    'error_code' => self::CODE_DISPATCH_FAILED,
                    'error_message_safe' => 'تعذر إرسال إعادة المحاولة؛ يمكنك المحاولة لاحقاً.',
                ])->save();
            }
            $fresh = $locked->fresh();
            $this->event($fresh, $actor, DocumentGovernanceEvent::ACTION_RETRY_REJECTED, self::CODE_DISPATCH_FAILED);

            return $fresh;
        }, 3);

        if ($failed->stage === DocumentExtractionService::STAGE_EXTRACTION) {
            $batch = $failed->batch()->firstOrFail();
            if ($batch->status === DocumentWorkflowStatus::QUEUED) {
                $this->workflow->transition($batch, DocumentWorkflowStatus::FAILED, 'extraction_retry_dispatch_failed', 'user', $actor?->id, null, ['stage' => $failed->stage]);
            }
        }

        return ['accepted' => false, 'code' => self::CODE_DISPATCH_FAILED, 'message' => 'تعذر إرسال إعادة المحاولة؛ يمكنك المحاولة لاحقاً.', 'run' => $failed];
    }

    private function rejected(DocumentProcessingRun $run, ?User $actor, string $code, string $message): array
    {
        $this->event($run, $actor, DocumentGovernanceEvent::ACTION_RETRY_REJECTED, $code);

        return ['accepted' => false, 'code' => $code, 'message' => $message, 'run' => $run];
    }

    /** @param array<string,mixed> $metadata */
    private function event(DocumentProcessingRun $run, ?User $actor, string $action, ?string $code, array $metadata = []): void
    {
        DocumentGovernanceEvent::create([
            'document_batch_id' => $run->document_batch_id,
            'document_file_id' => $run->document_file_id,
            'document_processing_run_id' => $run->id,
            'action' => $action,
            'stage' => $run->stage,
            'status' => $run->status->value,
            'reason_code' => $code,
            'actor_type' => $actor === null ? 'system' : 'user',
            'actor_id' => $actor?->id,
            'metadata' => $metadata,
        ]);
    }

    /** عدد دورات retry اليدوية المقبولة سابقاً لهذا الـ run، من سجل الحوكمة الدائم فقط. */
    private function manualRetryCycleCount(DocumentProcessingRun $run): int
    {
        return DocumentGovernanceEvent::query()
            ->where('document_processing_run_id', $run->id)
            ->where('action', DocumentGovernanceEvent::ACTION_RETRY_QUEUED)
            ->count();
    }

    private function manualRetryCycleLimit(): int
    {
        return max(1, (int) config('document_center.processing.manual_retry_max_cycles', 3));
    }

    private function stored(DocumentFile $file): bool
    {
        try {
            return $this->storage->exists($file->storage_profile, $file->object_key);
        } catch (\Throwable) {
            return false;
        }
    }
}
