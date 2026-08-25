<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\AssignDocumentReviewerRequest;
use App\Http\Requests\CompleteDocumentReviewRequest;
use App\Http\Requests\ConfirmDocumentMatchRequest;
use App\Http\Requests\DocumentIssueActionRequest;
use App\Http\Requests\RejectDocumentMatchRequest;
use App\Http\Requests\StoreDocumentReviewChangeRequest;
use App\Http\Resources\DocumentBatchReviewResource;
use App\Http\Resources\DocumentReviewResource;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentIssue;
use App\Models\DocumentMatchResult;
use App\Models\DocumentReviewAction;
use App\Services\DocumentCenter\DocumentReviewService;
use App\Services\DocumentCenter\ReviewedDocumentProjector;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocumentReviewController extends Controller
{
    public function __construct(private readonly DocumentReviewService $review)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $sort = in_array($request->string('sort')->toString(), ['created_at', 'status', 'document_type'], true)
            ? $request->string('sort')->toString() : 'created_at';
        $direction = $request->string('direction')->lower()->toString() === 'asc' ? 'asc' : 'desc';

        $batches = DocumentBatch::query()
            ->when($request->filled('status'), fn ($query) => $query->where('status', $request->string('status')->toString()))
            ->when($request->filled('document_type'), fn ($query) => $query->where('document_type', $request->string('document_type')->toString()))
            ->when($request->filled('source_type'), fn ($query) => $query->where('source_type', $request->string('source_type')->toString()))
            ->when($request->filled('reviewer_id'), fn ($query) => $query->where('review_assigned_to', $request->string('reviewer_id')->toString()))
            ->when($request->filled('from'), fn ($query) => $query->whereDate('created_at', '>=', $request->string('from')->toString()))
            ->when($request->filled('to'), fn ($query) => $query->whereDate('created_at', '<=', $request->string('to')->toString()))
            ->withCount(['files', 'issues as blocking_issues_count' => fn ($query) => $query->where('severity', 'blocking')->whereIn('status', ['open', 'reopened']), 'issues as warning_issues_count' => fn ($query) => $query->where('severity', 'warning')->whereIn('status', ['open', 'reopened'])])
            ->orderBy($sort, $direction)
            ->paginate(min(100, max(1, $request->integer('per_page', 25))));

        return DocumentBatchReviewResource::collection($batches)->response();
    }

    public function review(DocumentBatch $batch): DocumentReviewResource
    {
        $result = $this->resultFor($batch);
        $matches = DocumentMatchResult::query()->where('document_extraction_result_id', $result->id)->with('candidates')->get()->map(fn ($match) => [
            'id' => $match->id, 'subject_key' => $match->subject_key, 'status' => $match->status,
            'matched_type' => $match->matched_type, 'matched_id' => $match->matched_id,
            'score_basis_points' => $match->score_basis_points, 'strategy' => $match->strategy,
            'candidates' => $match->candidates->map(fn ($candidate) => ['id' => $candidate->id, 'candidate_type' => $candidate->candidate_type, 'candidate_id' => $candidate->candidate_id, 'score_basis_points' => $candidate->score_basis_points, 'strategy' => $candidate->strategy, 'is_active' => (bool) ($candidate->snapshot['is_active'] ?? true)]),
        ]);
        $issues = DocumentIssue::query()->where('document_extraction_result_id', $result->id)->get()->map(fn ($issue) => ['id' => $issue->id, 'code' => $issue->code, 'severity' => $issue->severity, 'status' => $issue->status, 'safe_message' => $issue->safe_message, 'subject_key' => $issue->subject_key]);
        $history = DocumentReviewAction::query()->where('document_batch_id', $batch->id)->latest('occurred_at')->get()->map(fn ($action) => ['id' => $action->id, 'action' => $action->action, 'subject_type' => $action->subject_type, 'subject_id' => $action->subject_id, 'before' => $action->before, 'after' => $action->after, 'reason' => $action->reason, 'review_version' => $action->review_version, 'occurred_at' => $action->occurred_at?->toIso8601String()]);

        return new DocumentReviewResource(['batch' => $batch, 'reviewed' => app(ReviewedDocumentProjector::class)->project($result), 'matches' => $matches, 'issues' => $issues, 'history' => $history]);
    }

    public function change(StoreDocumentReviewChangeRequest $request, DocumentBatch $batch): JsonResponse
    {
        $change = $this->review->change($batch, $this->resultFor($batch), $request->integer('expected_version'), $request->string('target_key')->toString(), $request->validated('value'), $request->string('reason')->toString(), $request->user()?->id);
        return response()->json(['data' => ['id' => $change->id]], 201);
    }

    public function confirm(ConfirmDocumentMatchRequest $request, DocumentMatchResult $match): JsonResponse { return response()->json(['data' => ['id' => $this->review->confirm($match, $request->string('candidate_id')->toString(), $request->integer('expected_version'), $request->string('reason')->toString(), $request->user()?->id)->id]]); }
    public function reject(RejectDocumentMatchRequest $request, DocumentMatchResult $match): JsonResponse { return response()->json(['data' => ['id' => $this->review->reject($match, $request->integer('expected_version'), $request->string('reason')->toString(), $request->user()?->id)->id]]); }
    public function resolve(DocumentIssueActionRequest $request, DocumentIssue $issue): JsonResponse { return response()->json(['data' => ['id' => $this->review->resolve($issue, $request->integer('expected_version'), $request->string('reason')->toString(), $request->user()?->id)->id]]); }
    public function reopen(DocumentIssueActionRequest $request, DocumentIssue $issue): JsonResponse { return response()->json(['data' => ['id' => $this->review->reopen($issue, $request->integer('expected_version'), $request->string('reason')->toString(), $request->user()?->id)->id]]); }
    public function assign(AssignDocumentReviewerRequest $request, DocumentBatch $batch): JsonResponse { return response()->json(['data' => ['id' => $this->review->assign($batch, $request->validated('reviewer_id'), $request->integer('expected_version'), $request->string('reason')->toString(), $request->user()?->id)->id]]); }
    public function complete(CompleteDocumentReviewRequest $request, DocumentBatch $batch): JsonResponse { return response()->json(['data' => ['id' => $this->review->complete($batch, $this->resultFor($batch), $request->integer('expected_version'), $request->user()?->id)->id]]); }

    private function resultFor(DocumentBatch $batch): DocumentExtractionResult { return DocumentExtractionResult::query()->where('document_batch_id', $batch->id)->latest('extracted_at')->firstOrFail(); }
}
