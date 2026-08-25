<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentIssue;
use App\Models\DocumentMatchCandidate;
use App\Models\DocumentMatchResult;
use App\Models\DocumentReviewAction;
use App\Models\DocumentReviewChange;
use App\Models\User;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

final class DocumentReviewService
{
    private const FINANCIAL_ISSUE_CODES = [
        'currency_missing',
        'line_total_mismatch',
        'financial_value_overflow',
        'discount_exceeds_line',
        'tax_total_mismatch',
        'document_total_mismatch',
    ];

    private const EDITABLE = [
        'fields.document_number' => 'text', 'fields.document_date' => 'date', 'fields.currency' => 'text',
        'lines.*.quantity' => 'quantity', 'lines.*.unit_price_minor' => 'minor', 'lines.*.discount_minor' => 'minor',
        'lines.*.tax_amount_minor' => 'minor', 'lines.*.total_minor' => 'minor',
    ];

    public function change(DocumentBatch $batch, DocumentExtractionResult $result, int $expectedVersion, string $targetKey, mixed $after, string $reason, ?string $actorId): DocumentReviewChange
    {
        return DB::transaction(function () use ($batch, $result, $expectedVersion, $targetKey, $after, $reason, $actorId): DocumentReviewChange {
            $batch = $this->lockedReviewBatch($batch, $expectedVersion);
            $result = $this->lockedResult($result, $batch);
            $type = $this->valueType($targetKey);
            $reason = $this->reason($reason);
            $before = app(ReviewedDocumentProjector::class)->value($result, $targetKey);
            $this->assertValue($type, $after);
            $change = DocumentReviewChange::create([
                'document_batch_id' => $batch->id, 'document_extraction_result_id' => $result->id,
                'target_type' => str_starts_with($targetKey, 'lines.') ? 'line' : 'field', 'target_key' => $targetKey,
                'before_value' => ['value' => $before], 'after_value' => ['value' => $after], 'value_type' => $type,
                'reason' => $reason, 'actor_id' => $actorId, 'review_version' => $expectedVersion + 1,
            ]);
            $this->bump($batch, $expectedVersion);
            $this->audit($batch, $result, 'change', 'review_change', $change->id, ['target_key' => $targetKey, 'value' => $before], ['target_key' => $targetKey, 'value' => $after], $actorId, $reason, $expectedVersion + 1);
            return $change;
        }, 3);
    }

    public function confirm(DocumentMatchResult $match, string $candidateId, int $expectedVersion, string $reason, ?string $actorId): DocumentMatchResult
    {
        return DB::transaction(function () use ($match, $candidateId, $expectedVersion, $reason, $actorId): DocumentMatchResult {
            $match = DocumentMatchResult::query()->whereKey($match->id)->lockForUpdate()->firstOrFail();
            $batch = $this->lockedReviewBatch($match->batch, $expectedVersion);
            $candidate = DocumentMatchCandidate::query()->where('document_match_result_id', $match->id)->whereKey($candidateId)->lockForUpdate()->firstOrFail();
            if (($candidate->snapshot['is_active'] ?? true) === false) {
                throw ValidationException::withMessages(['candidate' => 'Inactive candidates cannot be confirmed.']);
            }
            $before = $this->matchSnapshot($match);
            DocumentReviewMutationGate::run(function () use ($match, $candidate, $actorId): void {
                $match->status = 'confirmed';
                $match->matched_type = $candidate->candidate_type;
                $match->matched_id = $candidate->candidate_id;
                $match->confirmed_by = $actorId;
                $match->confirmed_at = now('UTC');
                $match->save();
            });
            $this->bump($batch, $expectedVersion);
            $this->audit($batch, $match->extractionResult, 'match_confirmed', 'match_result', $match->id, $before, $this->matchSnapshot($match), $actorId, $this->reason($reason), $expectedVersion + 1);
            return $match->fresh();
        }, 3);
    }

    public function reject(DocumentMatchResult $match, int $expectedVersion, string $reason, ?string $actorId): DocumentMatchResult
    {
        return DB::transaction(function () use ($match, $expectedVersion, $reason, $actorId): DocumentMatchResult {
            $match = DocumentMatchResult::query()->whereKey($match->id)->lockForUpdate()->firstOrFail();
            $batch = $this->lockedReviewBatch($match->batch, $expectedVersion);
            $before = $this->matchSnapshot($match);
            DocumentReviewMutationGate::run(function () use ($match, $actorId): void { $match->status = 'rejected'; $match->confirmed_by = $actorId; $match->confirmed_at = now('UTC'); $match->save(); });
            $this->bump($batch, $expectedVersion);
            $this->audit($batch, $match->extractionResult, 'match_rejected', 'match_result', $match->id, $before, $this->matchSnapshot($match), $actorId, $this->reason($reason), $expectedVersion + 1);
            return $match->fresh();
        }, 3);
    }

    public function resolve(DocumentIssue $issue, int $expectedVersion, string $reason, ?string $actorId): DocumentIssue { return $this->updateIssue($issue, true, $expectedVersion, $reason, $actorId); }
    public function reopen(DocumentIssue $issue, int $expectedVersion, string $reason, ?string $actorId): DocumentIssue { return $this->updateIssue($issue, false, $expectedVersion, $reason, $actorId); }

    public function assign(DocumentBatch $batch, ?string $reviewerId, int $expectedVersion, string $reason, ?string $actorId): DocumentBatch
    {
        return DB::transaction(function () use ($batch, $reviewerId, $expectedVersion, $reason, $actorId): DocumentBatch {
            $batch = $this->lockedReviewBatch($batch, $expectedVersion);
            if ($reviewerId !== null) {
                $reviewer = User::query()->where('tenant_id', $batch->tenant_id)->whereKey($reviewerId)->firstOrFail();
                if (! $reviewer->is_active || ! $reviewer->canAccessBranch($batch->branch_id) || ! $reviewer->hasPermission('documents.center.review')) {
                    throw ValidationException::withMessages(['reviewer_id' => 'The reviewer is not eligible for this document branch.']);
                }
            }
            $before = ['review_assigned_to' => $batch->review_assigned_to];
            DocumentReviewMutationGate::run(function () use ($batch, $reviewerId): void {
                $batch->review_assigned_to = $reviewerId;
                $batch->save();
            });
            $this->bump($batch, $expectedVersion);
            $this->audit($batch, null, $reviewerId === null ? 'reviewer_unassigned' : 'reviewer_assigned', 'batch', $batch->id, $before, ['review_assigned_to' => $reviewerId], $actorId, $this->reason($reason), $expectedVersion + 1);
            return $batch->fresh();
        }, 3);
    }

    /**
     * يعيد احتساب مشكلات الدليل المالي المراجع. لا يحق للمراجع حل فشل ضريبي يدوياً؛
     * لا تُغلق المشكلة إلا إذا لم يعد المدقق يعيد إنتاجها من projection الحالي.
     */
    public function revalidateFinancial(DocumentBatch $batch, DocumentExtractionResult $result, int $expectedVersion, string $reason, ?string $actorId): DocumentBatch
    {
        return DB::transaction(function () use ($batch, $result, $expectedVersion, $reason, $actorId): DocumentBatch {
            $batch = $this->lockedReviewBatch($batch, $expectedVersion);
            $result = $this->lockedResult($result, $batch);
            $reason = $this->reason($reason);
            $issues = app(DocumentFinancialValidator::class)->validate(
                app(ReviewedDocumentProjector::class)->project($result),
                $batch->document_type,
            );
            $expected = collect($issues)
                ->filter(fn (array $issue): bool => $issue['severity'] === 'blocking')
                ->keyBy(fn (array $issue): string => $issue['subject_key'].'|'.$issue['code']);
            $existing = DocumentIssue::query()
                ->where('document_batch_id', $batch->id)
                ->where('document_extraction_result_id', $result->id)
                ->whereIn('code', self::FINANCIAL_ISSUE_CODES)
                ->lockForUpdate()
                ->get()
                ->keyBy(fn (DocumentIssue $issue): string => $issue->subject_key.'|'.$issue->code);

            $before = $existing->map(fn (DocumentIssue $issue): array => [
                'id' => $issue->id,
                'subject_key' => $issue->subject_key,
                'code' => $issue->code,
                'status' => $issue->status,
            ])->values()->all();
            $changed = [];

            foreach ($existing as $key => $issue) {
                if ($expected->has($key)) {
                    continue;
                }
                if (in_array($issue->status, ['open', 'reopened'], true)) {
                    DocumentReviewMutationGate::run(function () use ($issue, $actorId): void {
                        $issue->status = 'resolved';
                        $issue->resolved_by = $actorId;
                        $issue->resolved_at = now('UTC');
                        $issue->save();
                    });
                    $changed[] = $issue->id;
                }
            }

            foreach ($expected as $key => $issue) {
                $current = $existing->get($key);
                if ($current === null) {
                    $current = DocumentIssue::create([
                        'document_batch_id' => $batch->id,
                        'document_extraction_result_id' => $result->id,
                        'subject_key' => $issue['subject_key'],
                        'code' => $issue['code'],
                        'severity' => $issue['severity'],
                        'status' => 'open',
                        'safe_message' => $issue['safe_message'],
                        'metadata' => $issue['metadata'],
                    ]);
                    $existing->put($key, $current);
                    $changed[] = $current->id;
                    continue;
                }
                if ($current->status === 'resolved') {
                    DocumentReviewMutationGate::run(function () use ($current): void {
                        $current->status = 'reopened';
                        $current->resolved_by = null;
                        $current->resolved_at = null;
                        $current->save();
                    });
                    $changed[] = $current->id;
                }
            }

            $after = $existing->map(fn (DocumentIssue $issue): array => [
                'id' => $issue->id,
                'subject_key' => $issue->subject_key,
                'code' => $issue->code,
                'status' => $issue->fresh()->status,
            ])->values()->all();
            $this->bump($batch, $expectedVersion);
            $this->audit($batch, $result, 'financial_revalidated', 'batch', $batch->id, $before, [
                'issues' => $after,
                'changed_issue_ids' => $changed,
            ], $actorId, $reason, $expectedVersion + 1);

            return $batch->fresh();
        }, 3);
    }

    public function complete(DocumentBatch $batch, DocumentExtractionResult $result, int $expectedVersion, string $reason, ?string $actorId): DocumentBatch
    {
        return DB::transaction(function () use ($batch, $result, $expectedVersion, $reason, $actorId): DocumentBatch {
            $locked = DocumentBatch::query()->whereKey($batch->id)->lockForUpdate()->firstOrFail();
            if ($locked->status === DocumentWorkflowStatus::READY_FOR_DRAFT) return $locked;
            $locked = $this->lockedReviewBatch($locked, $expectedVersion);
            $result = $this->lockedResult($result, $locked);
            $reason = $this->reason($reason);
            app(DocumentReviewReadinessPolicy::class)->assertReady($locked, $result);
            $before = ['status' => $locked->status->value];
            $completed = app(DocumentWorkflowService::class)->transition($locked, DocumentWorkflowStatus::READY_FOR_DRAFT, 'review_completed', 'user', $actorId, null, ['review_version' => $expectedVersion]);
            $this->audit($completed, $result, 'review_completed', 'batch', $completed->id, $before, ['status' => $completed->status->value], $actorId, $reason, $completed->version);
            return $completed;
        }, 3);
    }

    private function updateIssue(DocumentIssue $issue, bool $resolve, int $expectedVersion, string $reason, ?string $actorId): DocumentIssue
    {
        return DB::transaction(function () use ($issue, $resolve, $expectedVersion, $reason, $actorId): DocumentIssue {
            $issue = DocumentIssue::query()->whereKey($issue->id)->lockForUpdate()->firstOrFail();
            $batch = $this->lockedReviewBatch($issue->batch, $expectedVersion);
            $reason = $this->reason($reason);
            if ($resolve && $issue->severity === 'blocking' && str_starts_with($issue->code, 'tax_')) throw ValidationException::withMessages(['issue' => 'Blocking financial issues require revalidation.']);
            $before = ['status' => $issue->status, 'resolved_by' => $issue->resolved_by];
            DocumentReviewMutationGate::run(function () use ($issue, $resolve, $actorId): void { $issue->status = $resolve ? 'resolved' : 'reopened'; $issue->resolved_by = $resolve ? $actorId : null; $issue->resolved_at = $resolve ? now('UTC') : null; $issue->save(); });
            $this->bump($batch, $expectedVersion);
            $this->audit($batch, $issue->extractionResult, $resolve ? 'issue_resolved' : 'issue_reopened', 'issue', $issue->id, $before, ['status' => $issue->status, 'resolved_by' => $issue->resolved_by], $actorId, $reason, $expectedVersion + 1);
            return $issue->fresh();
        }, 3);
    }

    private function lockedReviewBatch(DocumentBatch $batch, int $expectedVersion): DocumentBatch { $locked = DocumentBatch::query()->whereKey($batch->id)->lockForUpdate()->firstOrFail(); if ($locked->status !== DocumentWorkflowStatus::NEEDS_REVIEW || $locked->version !== $expectedVersion) throw new StaleDocumentReviewVersion(); return $locked; }
    private function lockedResult(DocumentExtractionResult $result, DocumentBatch $batch): DocumentExtractionResult { $locked = DocumentExtractionResult::query()->whereKey($result->id)->where('document_batch_id', $batch->id)->lockForUpdate()->firstOrFail(); return $locked; }
    private function bump(DocumentBatch $batch, int $expectedVersion): void { if (DocumentBatch::query()->whereKey($batch->id)->where('version', $expectedVersion)->update(['version' => $expectedVersion + 1, 'updated_at' => now('UTC')]) !== 1) throw new LogicException('Document review version update failed.'); $batch->version = $expectedVersion + 1; }
    private function valueType(string $key): string { foreach (self::EDITABLE as $pattern => $type) if (preg_match('/^'.str_replace(['.', '*'], ['\\.', '\\d+'], $pattern).'$/', $key)) return $type; throw ValidationException::withMessages(['target_key' => 'Review target is not editable.']); }
    private function assertValue(string $type, mixed $value): void { if (($type === 'minor' && (!is_int($value) || $value < 0)) || ($type === 'quantity' && (!is_string($value) || !preg_match('/^\d+(?:\.\d{1,6})?$/', $value))) || (($type === 'text' || $type === 'date') && (!is_string($value) || mb_strlen($value) > 128))) throw ValidationException::withMessages(['value' => 'Review value is invalid.']); }
    private function reason(string $reason): string { $reason = trim($reason); if ($reason === '' || mb_strlen($reason) > 500) throw ValidationException::withMessages(['reason' => 'A bounded review reason is required.']); return $reason; }
    private function matchSnapshot(DocumentMatchResult $match): array { return ['status' => $match->status, 'matched_type' => $match->matched_type, 'matched_id' => $match->matched_id, 'confirmed_by' => $match->confirmed_by]; }
    private function audit(DocumentBatch $batch, ?DocumentExtractionResult $result, string $action, string $subjectType, ?string $subjectId, ?array $before, ?array $after, ?string $actorId, ?string $reason, int $version): void { DocumentReviewAction::create(['document_batch_id' => $batch->id, 'document_extraction_result_id' => $result?->id, 'subject_type' => $subjectType, 'subject_id' => $subjectId, 'action' => $action, 'before' => $before, 'after' => $after, 'actor_id' => $actorId, 'reason' => $reason, 'review_version' => $version, 'occurred_at' => now('UTC')]); }
}
