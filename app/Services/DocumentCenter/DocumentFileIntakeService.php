<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

class DocumentFileIntakeService
{
    public function __construct(
        private readonly DocumentFileInspector $inspector,
        private readonly DocumentStorageService $storage,
        private readonly DocumentWorkflowService $workflow,
        private readonly DocumentProcessingService $processing,
    ) {
    }

    public function ingest(DocumentBatch $batch, UploadedFile $uploadedFile, ?string $actorId): DocumentFile
    {
        if (! in_array($batch->status, [DocumentWorkflowStatus::DRAFT, DocumentWorkflowStatus::RECEIVING], true)) {
            throw ValidationException::withMessages(['batch' => 'لا تقبل الحزمة ملفات في حالتها الحالية.']);
        }

        $maximum = (int) config('document_center.intake.max_files_per_batch', 10);
        if ($batch->files()->count() >= $maximum) {
            throw ValidationException::withMessages(['file' => "الحد الأقصى للحزمة هو {$maximum} ملفات."]);
        }

        $inspected = $this->inspector->inspect($uploadedFile);
        if (DocumentFile::query()
            ->where('sha256', $inspected->sha256)
            ->where('size_bytes', $inspected->sizeBytes)
            ->exists()) {
            throw ValidationException::withMessages(['file' => 'هذا الملف مرفوع مسبقًا في الفرع الحالي.']);
        }

        $profile = $this->storage->profile();
        $objectKey = $this->objectKey($batch, $inspected->extension);
        $stream = fopen($uploadedFile->getRealPath(), 'rb');
        if (! is_resource($stream)) {
            throw ValidationException::withMessages(['file' => 'تعذر فتح الملف للرفع الآمن.']);
        }

        try {
            $this->storage->put($profile, $objectKey, $stream);
        } finally {
            fclose($stream);
        }

        try {
            return DB::transaction(function () use ($batch, $actorId, $profile, $objectKey, $inspected): DocumentFile {
                $freshBatch = DocumentBatch::query()->whereKey($batch->id)->lockForUpdate()->firstOrFail();
                if (! in_array($freshBatch->status, [DocumentWorkflowStatus::DRAFT, DocumentWorkflowStatus::RECEIVING], true)) {
                    throw ValidationException::withMessages(['batch' => 'تغيّرت حالة الحزمة ولم تعد تقبل ملفات.']);
                }
                if ($freshBatch->files()->count() >= (int) config('document_center.intake.max_files_per_batch', 10)) {
                    throw ValidationException::withMessages(['file' => 'اكتملت سعة الحزمة أثناء الرفع.']);
                }
                if ($freshBatch->status === DocumentWorkflowStatus::DRAFT) {
                    $freshBatch = $this->workflow->transition(
                        $freshBatch,
                        DocumentWorkflowStatus::RECEIVING,
                        'file_intake_started',
                        'user',
                        $actorId,
                    );
                }

                return DocumentFile::create([
                    'document_batch_id' => $freshBatch->id,
                    'storage_profile' => $profile,
                    'object_key' => $objectKey,
                    'original_name' => $inspected->originalName,
                    'declared_mime' => $inspected->declaredMime,
                    'detected_mime' => $inspected->detectedMime,
                    'size_bytes' => $inspected->sizeBytes,
                    'page_count' => $inspected->pageCount,
                    'sha256' => $inspected->sha256,
                    'scan_status' => DocumentScanStatus::PENDING,
                    'uploaded_by' => $actorId,
                    'retention_until' => now('UTC')->addDays((int) config('document_center.intake.retention_days', 365)),
                ]);
            }, 3);
        } catch (Throwable $exception) {
            $this->storage->delete($profile, $objectKey);
            throw $exception;
        }
    }

    public function complete(DocumentBatch $batch, ?string $actorId): DocumentBatch
    {
        if ($batch->status !== DocumentWorkflowStatus::RECEIVING || ! $batch->files()->exists()) {
            throw ValidationException::withMessages(['batch' => 'يجب أن تكون الحزمة قيد الاستقبال وتحتوي ملفًا واحدًا على الأقل.']);
        }

        $completed = $this->workflow->transition(
            $batch,
            DocumentWorkflowStatus::RECEIVED,
            'file_intake_completed',
            'user',
            $actorId,
            null,
            ['file_count' => $batch->files()->count()],
        );
        $this->processing->queueSafetyScans($completed);

        return $completed->fresh() ?? $completed;
    }

    private function objectKey(DocumentBatch $batch, string $extension): string
    {
        return sprintf(
            'tenants/%s/branches/%s/document-batches/%s/%s.%s',
            $batch->tenant_id,
            $batch->branch_id,
            $batch->id,
            (string) Str::uuid(),
            $extension,
        );
    }
}
