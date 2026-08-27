<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\DocumentGovernanceEvent;
use App\Models\DocumentRedactionOverlay;
use App\Models\DocumentRetentionHold;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class DocumentGovernanceService
{
    public function createHold(?DocumentBatch $batch, ?string $fileId, string $reasonCode, ?User $actor): DocumentRetentionHold
    {
        return DB::transaction(function () use ($batch, $fileId, $reasonCode, $actor): DocumentRetentionHold {
            $file = $fileId === null ? null : DocumentFile::query()->whereKey($fileId)->firstOrFail();
            $batchId = $batch?->id ?? $file?->document_batch_id;
            $lockedBatch = DocumentBatch::query()->whereKey($batchId)->lockForUpdate()->firstOrFail();
            $lockedFile = $file === null ? null : DocumentFile::query()->whereKey($file->id)->lockForUpdate()->firstOrFail();
            if ($batch !== null && $batch->id !== $lockedBatch->id) {
                throw ValidationException::withMessages(['document_batch_id' => 'الحزمة لم تعد متاحة في النطاق الحالي.']);
            }
            if ($lockedFile !== null && $lockedFile->document_batch_id !== $lockedBatch->id) {
                throw ValidationException::withMessages(['file_id' => 'الملف لا ينتمي إلى الحزمة المحددة.']);
            }
            $purgePending = $lockedFile?->purge_pending_at !== null
                || ($lockedFile === null && DocumentFile::query()
                    ->where('document_batch_id', $lockedBatch->id)
                    ->whereNotNull('purge_pending_at')
                    ->exists());
            if ($purgePending) {
                throw ValidationException::withMessages(['file_id' => 'الحذف المحكوم قيد الاستكمال؛ أعد محاولة إنشاء الحجز بعد المصالحة.']);
            }

            $query = DocumentRetentionHold::query()->active()->where('reason_code', $reasonCode);
            if ($lockedFile !== null) {
                $query->where('document_file_id', $lockedFile->id);
            } else {
                $query->where('document_batch_id', $lockedBatch->id);
            }
            $existing = $query->first();
            if ($existing !== null) {
                return $existing;
            }

            $hold = DocumentRetentionHold::create([
                'document_batch_id' => $lockedBatch->id,
                'document_file_id' => $lockedFile?->id,
                'reason_code' => $reasonCode,
                'created_by' => $actor?->id,
            ]);
            DocumentGovernanceEvent::create([
                'document_batch_id' => $lockedBatch->id,
                'document_file_id' => $lockedFile?->id,
                'document_retention_hold_id' => $hold->id,
                'action' => DocumentGovernanceEvent::ACTION_HOLD_CREATED,
                'reason_code' => $reasonCode,
                'actor_type' => $actor === null ? 'system' : 'user',
                'actor_id' => $actor?->id,
            ]);

            return $hold;
        }, 3);
    }

    public function releaseHold(DocumentRetentionHold $hold, string $reasonCode, ?User $actor): DocumentRetentionHold
    {
        return DB::transaction(function () use ($hold, $reasonCode, $actor): DocumentRetentionHold {
            $locked = DocumentRetentionHold::query()->whereKey($hold->id)->lockForUpdate()->firstOrFail();
            if ($locked->released_at !== null) {
                return $locked;
            }
            $locked->fill([
                'released_at' => now('UTC'),
                'released_by' => $actor?->id,
                'release_reason_code' => $reasonCode,
            ])->save();
            DocumentGovernanceEvent::create([
                'document_batch_id' => $locked->document_batch_id,
                'document_file_id' => $locked->document_file_id,
                'document_retention_hold_id' => $locked->id,
                'action' => DocumentGovernanceEvent::ACTION_HOLD_RELEASED,
                'reason_code' => $reasonCode,
                'actor_type' => $actor === null ? 'system' : 'user',
                'actor_id' => $actor?->id,
            ]);

            return $locked->fresh();
        }, 3);
    }

    public function redact(string $resultId, string $fieldPath, string $reasonCode, ?User $actor): DocumentRedactionOverlay
    {
        return DB::transaction(function () use ($resultId, $fieldPath, $reasonCode, $actor): DocumentRedactionOverlay {
            $existing = DocumentRedactionOverlay::query()
                ->where('document_extraction_result_id', $resultId)->where('field_path', $fieldPath)->first();
            if ($existing !== null) {
                return $existing;
            }
            $overlay = DocumentRedactionOverlay::create([
                'document_extraction_result_id' => $resultId,
                'field_path' => $fieldPath,
                'reason_code' => $reasonCode,
                'created_by' => $actor?->id,
            ]);
            $result = $overlay->result()->firstOrFail();
            DocumentGovernanceEvent::create([
                'document_batch_id' => $result->document_batch_id,
                'document_file_id' => $result->document_file_id,
                'document_redaction_overlay_id' => $overlay->id,
                'action' => DocumentGovernanceEvent::ACTION_REDACTED,
                'reason_code' => $reasonCode,
                'actor_type' => $actor === null ? 'system' : 'user',
                'actor_id' => $actor?->id,
                'metadata' => ['field_path' => $fieldPath],
            ]);

            return $overlay;
        }, 3);
    }
}
