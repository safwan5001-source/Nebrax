<?php

namespace App\Http\Controllers\Api;

use App\Contracts\DraftBuildContext;
use App\Http\Controllers\Controller;
use App\Http\Requests\AssignDocumentReviewerRequest;
use App\Http\Requests\CompleteDocumentReviewRequest;
use App\Http\Requests\ConfirmDocumentMatchRequest;
use App\Http\Requests\CreateDocumentExpenseDraftRequest;
use App\Http\Requests\CreateDocumentPurchaseDraftRequest;
use App\Http\Requests\DocumentIssueActionRequest;
use App\Http\Requests\RejectDocumentMatchRequest;
use App\Http\Requests\RevalidateDocumentFinancialRequest;
use App\Http\Requests\StoreDocumentReviewChangeRequest;
use App\Http\Resources\DocumentBatchReviewResource;
use App\Http\Resources\DocumentReviewResource;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentIssue;
use App\Models\DocumentMatchCandidate;
use App\Models\DocumentMatchResult;
use App\Models\DocumentReviewAction;
use App\Models\User;
use App\Services\DocumentCenter\DocumentRedactionProjector;
use App\Services\DocumentCenter\DocumentReviewService;
use App\Services\DocumentCenter\ExpenseDocumentDraftBuilder;
use App\Services\DocumentCenter\ExpenseDraftBuildOptions;
use App\Services\DocumentCenter\PurchaseDocumentDraftBuilder;
use App\Services\DocumentCenter\PurchaseDraftBuildOptions;
use App\Services\DocumentCenter\ReviewedDocumentProjector;
use App\Support\DocumentScanStatus;
use App\Support\DocumentSourceChannel;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

class DocumentReviewController extends Controller
{
    public function __construct(
        private readonly DocumentReviewService $review,
        private readonly DocumentRedactionProjector $redactions,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $sort = $request->string('sort')->toString();
        if (! in_array($sort, ['created_at', 'status', 'document_type'], true)) {
            $sort = 'created_at';
        }

        $direction = $request->string('direction')->lower()->toString() === 'asc' ? 'asc' : 'desc';
        $perPage = min(100, max(1, $request->integer('per_page', 25)));

        $batches = DocumentBatch::query()
            ->when($request->filled('status'), fn ($query) => $query->where('status', $request->string('status')->toString()))
            ->when($request->filled('document_type'), fn ($query) => $query->where('document_type', $request->string('document_type')->toString()))
            ->when($request->filled('source_type'), fn ($query) => $query->where('source_type', $request->string('source_type')->toString()))
            ->when($request->filled('channel'), function ($query) use ($request): void {
                $channel = DocumentSourceChannel::tryFrom($request->string('channel')->toString());
                if ($channel === null) {
                    $query->whereRaw('1 = 0');

                    return;
                }
                $query->whereHas('sourceReceipt', fn ($receipt) => $receipt->where('channel', $channel->value));
            })
            ->when($request->filled('reviewer_id'), fn ($query) => $query->where('review_assigned_to', $request->string('reviewer_id')->toString()))
            ->when($request->filled('from'), fn ($query) => $query->whereDate('created_at', '>=', $request->string('from')->toString()))
            ->when($request->filled('to'), fn ($query) => $query->whereDate('created_at', '<=', $request->string('to')->toString()))
            ->when($request->boolean('has_blocking'), fn ($query) => $query->whereHas(
                'issues',
                fn ($issues) => $issues->where('severity', 'blocking')->whereIn('status', ['open', 'reopened']),
            ))
            ->when($request->filled('search'), function ($query) use ($request): void {
                $term = $request->string('search')->toString();
                $query->where(function ($nested) use ($term): void {
                    $nested->where('id', 'like', "%{$term}%")
                        ->orWhere('document_type', 'like', "%{$term}%")
                        ->orWhere('source_type', 'like', "%{$term}%");
                });
            })
            ->with(['reviewer:id,name', 'sourceReceipt.identity:id,display_name,external_identity_masked'])
            ->withCount([
                'files',
                'issues as blocking_issues_count' => fn ($query) => $query
                    ->where('severity', 'blocking')
                    ->whereIn('status', ['open', 'reopened']),
                'issues as warning_issues_count' => fn ($query) => $query
                    ->where('severity', 'warning')
                    ->whereIn('status', ['open', 'reopened']),
            ])
            ->orderBy($sort, $direction)
            ->paginate($perPage);

        return DocumentBatchReviewResource::collection($batches)->response();
    }

    public function review(Request $request, DocumentBatch $batch): DocumentReviewResource
    {
        $batch->load(['files', 'reviewer:id,name', 'sourceReceipt.identity:id,display_name,external_identity_masked', 'transactionLinks.purchase', 'transactionLinks.expense']);
        $result = $this->resultFor($batch);
        // الـoverlay لا يمس evidence أو projection الذي يبني المسودة؛ يطبق فقط
        // على النسختين المرسلتين إلى واجهة العرض كي لا تظهر القيمة المحجوبة.
        $original = $this->redactions->apply($result, $result->normalized_payload);
        $reviewed = $this->redactions->apply($result, app(ReviewedDocumentProjector::class)->project($result));

        return new DocumentReviewResource([
            'batch' => $batch,
            'fields' => $this->fields($original, $reviewed),
            'files' => $this->files($batch->files),
            'matches' => $this->matches($result),
            'issues' => $this->issues($result),
            'history' => $this->history($batch, $result),
            'linked_transaction' => $this->linkedTransaction($batch),
            // يبقى الحقل التوافقي لمسار Purchase إلى أن تستهلك الواجهة العقد العام بالكامل.
            'linked_purchase' => $this->linkedPurchase($batch),
            'capabilities' => $this->capabilities($request->user()),
        ]);
    }

    public function change(StoreDocumentReviewChangeRequest $request, DocumentBatch $batch): JsonResponse
    {
        $change = $this->review->change(
            $batch,
            $this->resultFor($batch),
            $request->integer('expected_version'),
            $request->string('target_key')->toString(),
            $request->validated('value'),
            $request->string('reason')->toString(),
            $request->user()?->id,
        );

        return response()->json(['data' => ['id' => $change->id]], 201);
    }

    public function confirm(ConfirmDocumentMatchRequest $request, DocumentMatchResult $match): JsonResponse
    {
        $action = $this->review->confirm(
            $match,
            $request->string('candidate_id')->toString(),
            $request->integer('expected_version'),
            $request->string('reason')->toString(),
            $request->user()?->id,
        );

        return response()->json(['data' => ['id' => $action->id]]);
    }

    public function reject(RejectDocumentMatchRequest $request, DocumentMatchResult $match): JsonResponse
    {
        $action = $this->review->reject(
            $match,
            $request->integer('expected_version'),
            $request->string('reason')->toString(),
            $request->user()?->id,
        );

        return response()->json(['data' => ['id' => $action->id]]);
    }

    public function resolve(DocumentIssueActionRequest $request, DocumentIssue $issue): JsonResponse
    {
        $action = $this->review->resolve(
            $issue,
            $request->integer('expected_version'),
            $request->string('reason')->toString(),
            $request->user()?->id,
        );

        return response()->json(['data' => ['id' => $action->id]]);
    }

    public function reopen(DocumentIssueActionRequest $request, DocumentIssue $issue): JsonResponse
    {
        $action = $this->review->reopen(
            $issue,
            $request->integer('expected_version'),
            $request->string('reason')->toString(),
            $request->user()?->id,
        );

        return response()->json(['data' => ['id' => $action->id]]);
    }

    public function assign(AssignDocumentReviewerRequest $request, DocumentBatch $batch): JsonResponse
    {
        $action = $this->review->assign(
            $batch,
            $request->validated('reviewer_id'),
            $request->integer('expected_version'),
            $request->string('reason')->toString(),
            $request->user()?->id,
        );

        return response()->json(['data' => ['id' => $action->id]]);
    }

    public function createPurchaseDraft(CreateDocumentPurchaseDraftRequest $request, DocumentBatch $batch): JsonResponse
    {
        $draft = app(PurchaseDocumentDraftBuilder::class)->build(
            $batch,
            new DraftBuildContext(
                expectedVersion: $request->integer('expected_version'),
                reason: $request->string('reason')->toString(),
                actorId: $request->user()?->id,
                options: new PurchaseDraftBuildOptions(
                    warehouseId: $request->validated('warehouse_id'),
                    costCenterId: $request->validated('cost_center_id'),
                ),
            ),
        );

        return response()->json(['data' => [
            'document_batch_id' => $batch->id,
            'link_id' => $draft->linkId,
            'transaction_type' => $draft->transactionType,
            'transaction_id' => $draft->transactionId,
            'transaction_number' => $draft->transactionNumber,
            'status' => $draft->status,
            'url' => '/purchases/'.$draft->transactionId,
            'idempotent_replay' => $draft->idempotentReplay,
        ]], $draft->idempotentReplay ? 200 : 201);
    }

    public function createExpenseDraft(CreateDocumentExpenseDraftRequest $request, DocumentBatch $batch): JsonResponse
    {
        $draft = app(ExpenseDocumentDraftBuilder::class)->build(
            $batch,
            new DraftBuildContext(
                expectedVersion: $request->integer('expected_version'),
                reason: $request->string('reason')->toString(),
                actorId: $request->user()?->id,
                options: new ExpenseDraftBuildOptions(
                    accountId: $request->validated('account_id'),
                    categoryId: $request->validated('category_id'),
                    costCenterId: $request->validated('cost_center_id'),
                    paymentMethod: $request->validated('payment_method'),
                ),
            ),
        );

        return response()->json(['data' => [
            'document_batch_id' => $batch->id,
            'link_id' => $draft->linkId,
            'transaction_type' => $draft->transactionType,
            'transaction_id' => $draft->transactionId,
            'transaction_number' => $draft->transactionNumber,
            'status' => $draft->status,
            'url' => '/expenses/'.$draft->transactionId,
            'idempotent_replay' => $draft->idempotentReplay,
        ]], $draft->idempotentReplay ? 200 : 201);
    }

    public function revalidateFinancial(RevalidateDocumentFinancialRequest $request, DocumentBatch $batch): JsonResponse
    {
        $review = $this->review->revalidateFinancial(
            $batch,
            $this->resultFor($batch),
            $request->integer('expected_version'),
            $request->string('reason')->toString(),
            $request->user()?->id,
        );

        return response()->json(['data' => ['id' => $review->id]]);
    }

    public function complete(CompleteDocumentReviewRequest $request, DocumentBatch $batch): JsonResponse
    {
        $action = $this->review->complete(
            $batch,
            $this->resultFor($batch),
            $request->integer('expected_version'),
            $request->string('reason')->toString(),
            $request->user()?->id,
        );

        return response()->json(['data' => ['id' => $action->id]]);
    }

    /** @param array<string, mixed> $original @param array<string, mixed> $reviewed @return array<int, array<string, mixed>> */
    private function fields(array $original, array $reviewed): array
    {
        $originalFields = is_array($original['fields'] ?? null) ? $original['fields'] : [];
        $reviewedFields = is_array($reviewed['fields'] ?? null) ? $reviewed['fields'] : [];
        $evidence = is_array($original['field_evidence'] ?? null) ? $original['field_evidence'] : [];
        $keys = array_values(array_unique(array_merge(array_keys($originalFields), array_keys($reviewedFields))));

        return collect($keys)
            ->filter(fn ($key) => is_string($key) && $key !== '')
            ->take(100)
            ->map(function (string $key) use ($originalFields, $reviewedFields, $evidence): array {
                $fieldEvidence = is_array($evidence[$key] ?? null) ? $evidence[$key] : [];

                return array_filter([
                    'key' => $key,
                    'original' => $this->safeValue($originalFields[$key] ?? null),
                    'current' => $this->safeValue($reviewedFields[$key] ?? null),
                    'confidence_basis_points' => $this->confidence($fieldEvidence),
                    'page' => $this->page($fieldEvidence),
                    'bounds' => $this->bounds($fieldEvidence),
                ], fn ($value) => $value !== null);
            })
            ->values()
            ->all();
    }

    /** @param Collection<int, DocumentFile> $files @return array<int, array<string, mixed>> */
    private function files(Collection $files): array
    {
        return $files->map(fn (DocumentFile $file) => [
            'id' => $file->id,
            'original_name' => $file->original_name,
            'mime_type' => $file->detected_mime ?: $file->declared_mime,
            'page_count' => $file->page_count,
            'download_available' => $file->scan_status === DocumentScanStatus::CLEAN && $file->purged_at === null,
        ])->values()->all();
    }

    /** @return array<int, array<string, mixed>> */
    private function matches(DocumentExtractionResult $result): array
    {
        return DocumentMatchResult::query()
            ->where('document_extraction_result_id', $result->id)
            ->with('candidates')
            ->get()
            ->map(fn (DocumentMatchResult $match) => [
                'id' => $match->id,
                'subject_key' => $match->subject_key,
                'status' => $match->status,
                'score_basis_points' => $match->score_basis_points,
                'strategy' => $match->strategy,
                'candidates' => $match->candidates
                    ->map(fn (DocumentMatchCandidate $candidate) => $this->candidate($candidate))
                    ->values()
                    ->all(),
            ])
            ->values()
            ->all();
    }

    /** @return array<string, mixed> */
    private function candidate(DocumentMatchCandidate $candidate): array
    {
        $snapshot = $candidate->snapshot;
        $label = $this->firstText($snapshot, ['name', 'display_name', 'sku', 'code', 'label'])
            ?? $candidate->candidate_type;

        return array_filter([
            'id' => $candidate->id,
            'label' => $label,
            'candidate_type' => $candidate->candidate_type,
            'name' => $this->text($snapshot['name'] ?? $snapshot['display_name'] ?? null),
            'sku' => $this->text($snapshot['sku'] ?? null),
            'unit' => $this->text($snapshot['unit'] ?? null),
            'score_basis_points' => $candidate->score_basis_points,
            'strategy' => $candidate->strategy,
            'is_active' => (bool) ($snapshot['is_active'] ?? true),
        ], fn ($value) => $value !== null);
    }

    /** @return array<int, array<string, mixed>> */
    private function issues(DocumentExtractionResult $result): array
    {
        return DocumentIssue::query()
            ->where('document_extraction_result_id', $result->id)
            ->get()
            ->map(fn (DocumentIssue $issue) => [
                'id' => $issue->id,
                'code' => $issue->code,
                'severity' => $issue->severity,
                'status' => $issue->status,
                'safe_message' => $issue->safe_message,
                'subject_key' => $issue->subject_key,
            ])
            ->values()
            ->all();
    }

    /** @return array<int, array<string, mixed>> */
    private function history(DocumentBatch $batch, DocumentExtractionResult $result): array
    {
        return DocumentReviewAction::query()
            ->where('document_batch_id', $batch->id)
            ->with('actor:id,name')
            ->latest('occurred_at')
            ->get()
            ->map(fn (DocumentReviewAction $action) => array_filter([
                'id' => $action->id,
                'action' => $action->action,
                'reason' => $action->reason,
                'before' => $this->redactedAuditValue($result, $action->before),
                'after' => $this->redactedAuditValue($result, $action->after),
                'review_version' => $action->review_version,
                'actor' => $action->actor
                    ? ['id' => $action->actor->id, 'name' => $action->actor->name]
                    : null,
                'occurred_at' => $action->occurred_at?->toIso8601String(),
            ], fn ($value) => $value !== null))
            ->values()
            ->all();
    }

    /** @param array<string,mixed>|null $snapshot @return array<string,string|int|bool>|null */
    private function redactedAuditValue(DocumentExtractionResult $result, ?array $snapshot): ?array
    {
        $safe = $this->safeAuditValue($snapshot);
        $targetKey = $safe['target_key'] ?? null;
        if (is_string($targetKey) && $this->redactions->isRedacted($result, $targetKey)) {
            $safe['value'] = DocumentRedactionProjector::MARKER;
        }

        return $safe;
    }

    /** @return array<string, bool> */
    private function capabilities(?User $user): array
    {
        return [
            'view' => $user?->hasPermission('documents.center.view') ?? false,
            'review' => $user?->hasPermission('documents.center.review') ?? false,
            'manage' => $user?->hasPermission('documents.center.manage') ?? false,
            'build_draft' => $user?->hasPermission('documents.center.build_draft') ?? false,
        ];
    }

    /** @return array<string, string>|null */
    private function linkedTransaction(DocumentBatch $batch): ?array
    {
        $link = $batch->transactionLinks->firstWhere('transaction_type', $batch->document_type === 'expense' ? 'expense' : 'purchase');
        if ($link === null) {
            return null;
        }
        $transaction = $link->transaction_type === 'expense' ? $link->expense : $link->purchase;
        if ($transaction === null) {
            return null;
        }

        return [
            'link_id' => $link->id,
            'transaction_type' => $link->transaction_type,
            'transaction_id' => $transaction->id,
            'transaction_number' => $transaction->number,
            'status' => $transaction->status,
            'url' => $link->transaction_type === 'expense' ? '/expenses/'.$transaction->id : '/purchases/'.$transaction->id,
        ];
    }

    /** @return array<string, string>|null توافق قراءة PR-7. */
    private function linkedPurchase(DocumentBatch $batch): ?array
    {
        if ($batch->document_type !== 'purchase_invoice') {
            return null;
        }

        return $this->linkedTransaction($batch);
    }

    private function resultFor(DocumentBatch $batch): DocumentExtractionResult
    {
        return DocumentExtractionResult::query()
            ->where('document_batch_id', $batch->id)
            ->latest('extracted_at')
            ->firstOrFail();
    }

    private function safeValue(mixed $value): string|int|bool|null
    {
        if (is_string($value)) {
            return mb_substr($value, 0, 500);
        }

        return is_int($value) || is_bool($value) ? $value : null;
    }

    /** @param array<string, mixed> $evidence */
    private function confidence(array $evidence): ?int
    {
        $value = $evidence['confidence_basis_points'] ?? null;

        return is_int($value) && $value >= 0 && $value <= 10000 ? $value : null;
    }

    /** @param array<string, mixed> $evidence */
    private function page(array $evidence): ?int
    {
        $value = $evidence['page'] ?? $evidence['page_number'] ?? null;

        return is_int($value) && $value > 0 ? $value : null;
    }

    /** @param array<string, mixed> $evidence @return array<string, int>|null */
    private function bounds(array $evidence): ?array
    {
        $bounds = $evidence['bounds'] ?? $evidence['bounding_box'] ?? null;
        if (! is_array($bounds)) {
            return null;
        }

        $safe = [];
        foreach (['x', 'y', 'width', 'height'] as $key) {
            if (is_int($bounds[$key] ?? null)) {
                $safe[$key] = $bounds[$key];
            }
        }

        return count($safe) === 4 ? $safe : null;
    }

    /** @param array<string, mixed> $snapshot */
    private function firstText(array $snapshot, array $keys): ?string
    {
        foreach ($keys as $key) {
            $value = $this->text($snapshot[$key] ?? null);
            if ($value !== null) {
                return $value;
            }
        }

        return null;
    }

    private function text(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $value = trim(mb_substr($value, 0, 255));

        return $value === '' ? null : $value;
    }

    /** @return array<string, string|int|bool>|null */
    private function safeAuditValue(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }

        $safe = [];
        foreach ($value as $key => $item) {
            if (! is_string($key) || preg_match('/api[_-]?key|secret|token|password|raw[_-]?payload|object[_-]?key/i', $key)) {
                continue;
            }

            $scalar = $this->safeValue($item);
            if ($scalar !== null) {
                $safe[$key] = $scalar;
            }
        }

        return $safe === [] ? null : $safe;
    }
}
