<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentIssue;
use App\Models\DocumentMatchCandidate;
use App\Models\DocumentMatchResult;
use App\Models\DocumentReviewChange;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

final class DocumentReviewService
{
    private const EDITABLE = ['fields.document_number' => 'text', 'fields.document_date' => 'date', 'fields.currency' => 'text', 'lines.*.quantity' => 'quantity', 'lines.*.unit_price_minor' => 'minor', 'lines.*.discount_minor' => 'minor', 'lines.*.tax_amount_minor' => 'minor', 'lines.*.total_minor' => 'minor'];

    public function change(DocumentBatch $batch, DocumentExtractionResult $result, int $expectedVersion, string $targetKey, mixed $after, string $reason, ?string $actorId): DocumentReviewChange
    {
        return DB::transaction(function () use ($batch, $result, $expectedVersion, $targetKey, $after, $reason, $actorId): DocumentReviewChange {
            $locked = $this->lockedBatch($batch, $expectedVersion);
            $type = $this->valueType($targetKey);
            $before = app(ReviewedDocumentProjector::class)->value($result, $targetKey);
            $this->assertValue($type, $after);
            $change = DocumentReviewChange::create(['document_batch_id' => $locked->id, 'document_extraction_result_id' => $result->id, 'target_type' => str_starts_with($targetKey, 'lines.') ? 'line' : 'field', 'target_key' => $targetKey, 'before_value' => ['value' => $before], 'after_value' => ['value' => $after], 'value_type' => $type, 'reason' => $this->reason($reason), 'actor_id' => $actorId, 'review_version' => $expectedVersion + 1]);
            $this->bump($locked, $expectedVersion);
            return $change;
        }, 3);
    }

    public function decide(DocumentMatchResult $match, ?string $candidateId, bool $confirm, int $expectedVersion, string $reason, ?string $actorId): DocumentMatchResult
    {
        return DB::transaction(function () use ($match, $candidateId, $confirm, $expectedVersion, $reason, $actorId): DocumentMatchResult {
            $lockedMatch = DocumentMatchResult::query()->whereKey($match->id)->lockForUpdate()->firstOrFail();
            $batch = $this->lockedBatch($lockedMatch->batch, $expectedVersion);
            if ($confirm) {
                $candidate = DocumentMatchCandidate::query()->where('document_match_result_id', $lockedMatch->id)->whereKey($candidateId)->firstOrFail();
                if (($candidate->snapshot['is_active'] ?? true) === false) throw ValidationException::withMessages(['candidate' => 'Inactive candidates cannot be confirmed.']);
                $lockedMatch->status = 'confirmed'; $lockedMatch->matched_type = $candidate->candidate_type; $lockedMatch->matched_id = $candidate->candidate_id; $lockedMatch->confirmed_by = $actorId; $lockedMatch->confirmed_at = now('UTC');
            } else { $lockedMatch->status = 'rejected'; $lockedMatch->confirmed_by = $actorId; $lockedMatch->confirmed_at = now('UTC'); }
            $lockedMatch->save();
            $this->bump($batch, $expectedVersion);
            return $lockedMatch->fresh();
        }, 3);
    }

    public function issue(DocumentIssue $issue, bool $resolve, int $expectedVersion, string $reason, ?string $actorId): DocumentIssue
    {
        return DB::transaction(function () use ($issue, $resolve, $expectedVersion, $reason, $actorId): DocumentIssue {
            $lockedIssue = DocumentIssue::query()->whereKey($issue->id)->lockForUpdate()->firstOrFail();
            $batch = $this->lockedBatch($lockedIssue->batch, $expectedVersion);
            $this->reason($reason);
            if ($resolve && $lockedIssue->severity === 'blocking' && str_starts_with($lockedIssue->code, 'tax_')) throw ValidationException::withMessages(['issue' => 'Blocking financial issues require revalidation.']);
            $lockedIssue->status = $resolve ? 'resolved' : 'reopened'; $lockedIssue->resolved_by = $resolve ? $actorId : null; $lockedIssue->resolved_at = $resolve ? now('UTC') : null; $lockedIssue->save();
            $this->bump($batch, $expectedVersion);
            return $lockedIssue->fresh();
        }, 3);
    }

    public function complete(DocumentBatch $batch, DocumentExtractionResult $result, int $expectedVersion, ?string $actorId): DocumentBatch
    {
        app(DocumentReviewReadinessPolicy::class)->assertReady($batch, $result);
        return app(DocumentWorkflowService::class)->transition($batch, DocumentWorkflowStatus::READY_FOR_DRAFT, 'review_completed', 'user', $actorId, null, ['review_version' => $expectedVersion]);
    }

    private function lockedBatch(DocumentBatch $batch, int $expectedVersion): DocumentBatch { $locked = DocumentBatch::query()->whereKey($batch->id)->lockForUpdate()->firstOrFail(); if ($locked->status !== DocumentWorkflowStatus::NEEDS_REVIEW || $locked->version !== $expectedVersion) throw ValidationException::withMessages(['version' => 'Document review state changed concurrently.']); return $locked; }
    private function bump(DocumentBatch $batch, int $expectedVersion): void { if (DocumentBatch::query()->whereKey($batch->id)->where('version', $expectedVersion)->update(['version' => $expectedVersion + 1, 'updated_at' => now('UTC')]) !== 1) throw new LogicException('Document review version update failed.'); }
    private function valueType(string $key): string { foreach (self::EDITABLE as $pattern => $type) if (preg_match('/^'.str_replace(['.', '*'], ['\\.', '\\d+'], $pattern).'$/', $key)) return $type; throw ValidationException::withMessages(['target_key' => 'Review target is not editable.']); }
    private function assertValue(string $type, mixed $value): void { if (($type === 'minor' && (!is_int($value) || $value < 0)) || ($type === 'quantity' && (!is_string($value) || !preg_match('/^\d+(?:\.\d{1,6})?$/', $value))) || (($type === 'text' || $type === 'date') && (!is_string($value) || mb_strlen($value) > 128))) throw ValidationException::withMessages(['value' => 'Review value is invalid.']); }
    private function reason(string $reason): string { $reason = trim($reason); if ($reason === '' || mb_strlen($reason) > 500) throw ValidationException::withMessages(['reason' => 'A bounded review reason is required.']); return $reason; }
}
