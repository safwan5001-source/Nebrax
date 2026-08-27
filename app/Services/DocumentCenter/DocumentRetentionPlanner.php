<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentRetentionHold;
use App\Models\DocumentTransactionLink;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use Carbon\CarbonImmutable;

/** يحسب eligibility فقط؛ لا يكتب metadata ولا يستدعي التخزين. */
final class DocumentRetentionPlanner
{
    /** @return array{eligible:bool,reason_code:string,next_eligible_at:?string} */
    public function decide(DocumentFile $file, int $retentionDays, CarbonImmutable $cutoff): array
    {
        if ($file->purged_at !== null) {
            return $this->no('already_purged');
        }

        // `retention_until` سجل intake تاريخياً من config الثابت؛ سياسة المنصة
        // المحكومة هي مصدر القرار الواحد كي لا تصبح قيمة intake القديمة override صامتاً.
        $eligibleAt = $file->created_at->toImmutable()->addDays($retentionDays);
        if ($eligibleAt->isAfter($cutoff)) {
            return $this->no('retention_not_due', $eligibleAt);
        }

        $batch = $file->batch()->first();
        if ($batch === null) {
            return $this->no('batch_unavailable');
        }
        if ($this->hasActiveHold($file, $batch->id)) {
            return $this->no('active_hold');
        }
        if (DocumentTransactionLink::query()->where('document_batch_id', $batch->id)->exists()) {
            return $this->no('linked_transaction_evidence');
        }
        if ($batch->status === DocumentWorkflowStatus::QUARANTINED) {
            return $this->no('quarantine_retention');
        }
        if (! in_array($batch->status, [DocumentWorkflowStatus::ARCHIVED, DocumentWorkflowStatus::CANCELLED, DocumentWorkflowStatus::DUPLICATE], true)) {
            return $this->no('workflow_not_closed');
        }
        if (DocumentProcessingRun::query()->where('document_file_id', $file->id)
            ->whereIn('status', [DocumentProcessingStatus::QUEUED->value, DocumentProcessingStatus::RUNNING->value])->exists()) {
            return $this->no('processing_active');
        }
        if ($file->scan_status !== DocumentScanStatus::CLEAN) {
            return $this->no('scan_not_clean');
        }

        return ['eligible' => true, 'reason_code' => 'eligible', 'next_eligible_at' => $eligibleAt->toIso8601String()];
    }

    private function hasActiveHold(DocumentFile $file, string $batchId): bool
    {
        return DocumentRetentionHold::query()->active()
            ->where(function ($query) use ($file, $batchId): void {
                $query->where('document_file_id', $file->id)->orWhere('document_batch_id', $batchId);
            })->exists();
    }

    /** @return array{eligible:false,reason_code:string,next_eligible_at:?string} */
    private function no(string $reason, ?CarbonImmutable $next = null): array
    {
        return ['eligible' => false, 'reason_code' => $reason, 'next_eligible_at' => $next?->toIso8601String()];
    }
}
