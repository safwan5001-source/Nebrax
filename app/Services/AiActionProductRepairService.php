<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionApproval;
use App\Models\AiActionEvent;
use App\Models\AiActionExecution;
use App\Models\AiActionExecutionImage;
use App\Models\AiActionExecutionRow;
use App\Models\AiActionPreview;
use App\Models\AiActionRepair;
use App\Models\User;
use App\Support\AiActionException;
use App\Support\ProductImportFields;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * AI-ACTIONS-06B: repairs an execution by creating a NEW action that holds only the rows it could not apply.
 *
 * Nothing about the original is touched: its action, approval, preview, execution and per-row/per-image results stay
 * exactly as they were (audit), and a row that succeeded is never part of a repair, so it cannot be created or updated
 * twice. The repair then goes through the ordinary review → preview → approval → execution path, so every guard
 * (fresh RBAC, tenant/branch, matching and conflict detection, cost authority, approval expiry, idempotency, the
 * execution lease) applies again to the corrected data. Only fields tied to the failure may be edited.
 */
final class AiActionProductRepairService
{
    /** Statuses in which a repair action may still change or run — only one such repair per execution. */
    private const OPEN = [
        AiAction::STATUS_CREATED, AiAction::STATUS_EDITING, AiAction::STATUS_READY_FOR_APPROVAL,
        AiAction::STATUS_APPROVED, AiAction::STATUS_EXPIRED, AiAction::STATUS_EXECUTING,
    ];

    /** Failure code → the fields whose value can have caused it. Anything not listed is not a data problem. */
    private const CODE_FIELDS = [
        'conflict_existing_product' => ['sku', 'barcode'],
        'target_not_found' => ['nebrax_id', 'sku', 'barcode'],
        'target_changed' => ['nebrax_id', 'sku', 'barcode'],
        'reference_changed' => ['category', 'brand'],
        'reference_missing' => ['category', 'brand'],
    ];
    private const IMAGE_FIELDS = ['primary_image_url', 'additional_image_urls'];

    public function __construct(
        private readonly AiActionGateway $gateway,
        private readonly AiActionProductReviewService $review,
        private readonly AiActionProductImageStager $stager,
        private readonly TenantContext $tenantContext,
    ) {}

    /**
     * What a repair of this execution would contain, and what blocks it.
     *
     * @return array{rows:list<array<string,mixed>>,retry_pending:int,open_repair:?array<string,mixed>,reason:?string}
     */
    public function candidates(User $requestActor, AiAction $origin, string $executionId): array
    {
        $this->gateway->authorizeFor($requestActor, $origin, AiActionPolicy::USE);
        $this->assertProductImport($origin);
        $execution = $this->execution($origin, $executionId);

        return $this->compute($origin, $execution);
    }

    /** @return array{action:AiAction,repair:AiActionRepair,replayed:bool} */
    public function start(User $requestActor, AiAction $origin, string $executionId): array
    {
        $actor = $this->gateway->authorizeFor($requestActor, $origin, AiActionPolicy::REPAIR);
        $this->assertProductImport($origin);
        $execution = $this->execution($origin, $executionId);

        $written = [];
        try {
            return DB::transaction(function () use ($actor, $origin, $execution, &$written): array {
                // Serialises concurrent "start repair" requests for the same action.
                $locked = AiAction::query()->whereKey($origin->id)->lockForUpdate()->firstOrFail();
                if (! in_array($locked->status, [AiAction::STATUS_PARTIALLY_FAILED, AiAction::STATUS_FAILED], true)) {
                    throw new AiActionException('repair_not_available', 'لا يوجد ما يُصلَح: لم يفشل شيء في هذا التنفيذ أو لم ينتهِ بعد.', 409);
                }
                $plan = $this->compute($locked, $execution);
                if ($plan['open_repair'] !== null) {
                    $repair = AiActionRepair::query()->where('ai_action_id', $plan['open_repair']['action_id'])->firstOrFail();

                    return ['action' => AiAction::query()->whereKey($repair->ai_action_id)->firstOrFail(), 'repair' => $repair, 'replayed' => true];
                }
                if ($plan['rows'] === []) {
                    throw new AiActionException($plan['retry_pending'] > 0 ? 'repair_use_retry' : 'nothing_to_repair', $plan['reason'] ?? 'لا توجد صفوف قابلة للإصلاح.', 409);
                }

                $effective = $this->review->effective($locked)['proposal']['rows'] ?? [];
                $byId = [];
                foreach ($effective as $row) {
                    $byId[(string) $row['row_id']] = $row;
                }
                $rows = [];
                $map = [];
                $imageIds = [];
                foreach ($plan['rows'] as $candidate) {
                    $source = $byId[$candidate['row_id']] ?? null;
                    if ($source === null) {
                        continue;
                    }
                    $rows[] = $candidate['kind'] === 'images' ? $this->imageRow($source, $candidate) : $source;
                    $map[$candidate['row_id']] = [
                        'kind' => $candidate['kind'], 'origin_operation' => $candidate['operation'], 'source_row' => $candidate['source_row'],
                        'failure' => $candidate['failure'], 'affected_fields' => $candidate['affected_fields'], 'scope' => $candidate['scope'],
                    ];
                    $imageIds = array_merge($imageIds, $candidate['image_ids']);
                }
                if ($rows === []) {
                    throw new AiActionException('nothing_to_repair', 'تعذّر بناء صفوف الإصلاح من المسودة الأصلية.', 409);
                }

                // The repair is an ordinary action (cost guard included): it can only carry the cost values its creator may see.
                $action = $this->gateway->create($actor, AiActionRegistry::PRODUCT_IMPORT, ['schema_version' => 1, 'rows' => $rows]);
                $this->stager->copyBetween($locked, $action, $imageIds, $actor, $written);
                $repair = new AiActionRepair();
                $repair->forceFill([
                    'ai_action_id' => $action->id, 'origin_action_id' => $locked->id, 'origin_execution_id' => $execution->id,
                    'created_by' => $actor->id, 'rows' => $map,
                ])->save();
                $this->event($action, 'repair_created', $actor, ['origin_action_id' => $locked->id, 'origin_execution_id' => $execution->id, 'rows' => count($map)]);
                $this->event($locked, 'repair_started', $actor, ['repair_action_id' => $action->id, 'rows' => array_keys($map)]);

                return ['action' => $action, 'repair' => $repair, 'replayed' => false];
            }, 3);
        } catch (\Throwable $e) {
            $this->stager->discardObjects($written);
            throw $e;
        }
    }

    /**
     * The repair view for an action created by `start()`: where it came from, and for each row why it failed
     * and which fields the repair may change.
     *
     * @return array<string,mixed>
     */
    public function info(User $requestActor, AiAction $action): array
    {
        $this->gateway->authorizeFor($requestActor, $action, AiActionPolicy::USE);
        $repair = AiActionRepair::query()->where('ai_action_id', $action->id)->first();
        if ($repair === null) {
            throw new AiActionException('not_a_repair', 'هذه العملية ليست إصلاحاً.', 404);
        }
        $origin = AiAction::query()->whereKey($repair->origin_action_id)->first();
        $display = [];
        $previewRows = AiActionPreview::query()->whereKey(AiActionExecution::query()->whereKey($repair->origin_execution_id)->value('ai_action_preview_id'))->value('preview')['rows'] ?? [];
        foreach ($previewRows as $row) {
            $display[(string) $row['row_id']] = $row['display'] ?? null;
        }

        return [
            'repair_id' => $repair->id,
            'action_id' => $action->id,
            'origin' => ['action_id' => $repair->origin_action_id, 'execution_id' => $repair->origin_execution_id, 'status' => $origin?->status],
            'created_at' => optional($repair->created_at)->toIso8601String(),
            'rows' => collect($repair->rows)->map(fn (array $row, string $rowId): array => $row + ['row_id' => $rowId, 'display' => $display[$rowId] ?? null])->values()->all(),
        ];
    }

    /** The fields a repair action may edit on a row (`null` = not a repair; no restriction). @return list<string>|null */
    public function editableFields(AiAction $action, string $rowId): ?array
    {
        $repair = AiActionRepair::query()->where('ai_action_id', $action->id)->first();

        return $repair === null ? null : ($repair->rows[$rowId]['affected_fields'] ?? []);
    }

    /** @return array{rows:list<array<string,mixed>>,retry_pending:int,open_repair:?array<string,mixed>,reason:?string} */
    private function compute(AiAction $origin, AiActionExecution $execution): array
    {
        $repairs = AiActionRepair::query()->where('origin_execution_id', $execution->id)->get();
        $open = null;
        $resolved = [];
        foreach ($repairs as $repair) {
            $action = AiAction::query()->whereKey($repair->ai_action_id)->first();
            if ($action !== null && in_array($action->status, self::OPEN, true)) {
                $open = ['action_id' => $action->id, 'status' => $action->status];
            }
            $done = AiActionExecution::query()->where('ai_action_id', $repair->ai_action_id)->first();
            if ($done === null) {
                continue;
            }
            foreach (AiActionExecutionRow::query()->where('ai_action_execution_id', $done->id)->where('status', AiActionExecutionRow::STATUS_SUCCESS)->get() as $row) {
                $imagesFailed = AiActionExecutionImage::query()->where('ai_action_execution_row_id', $row->id)->where('status', AiActionExecutionImage::STATUS_FAILED)->exists();
                if (! $imagesFailed) {
                    $resolved[$row->row_id] = true; // fixed by an earlier repair: never offered again
                }
            }
        }

        $base = ['rows' => [], 'retry_pending' => 0, 'open_repair' => $open, 'reason' => null];
        if (! in_array($execution->status, [AiActionExecution::STATUS_PARTIALLY_FAILED, AiActionExecution::STATUS_FAILED], true)) {
            return $base + ['reason' => 'لا يمكن الإصلاح قبل انتهاء التنفيذ أو حين لا يوجد فشل.'];
        }

        $approval = AiActionApproval::query()->whereKey($execution->ai_action_approval_id)->first();
        $approvalActive = $approval?->isActive() === true;
        $previewRows = [];
        foreach (AiActionPreview::query()->whereKey($execution->ai_action_preview_id)->value('preview')['rows'] ?? [] as $row) {
            $previewRows[(string) $row['row_id']] = $row;
        }
        $proposalRows = [];
        foreach ($this->review->effective($origin)['proposal']['rows'] ?? [] as $row) {
            $proposalRows[(string) $row['row_id']] = $row;
        }

        $rows = [];
        $retryPending = 0;
        $execRows = AiActionExecutionRow::query()->where('ai_action_execution_id', $execution->id)->orderBy('source_row')->get();
        $failedImages = AiActionExecutionImage::query()->where('ai_action_execution_id', $execution->id)->where('status', AiActionExecutionImage::STATUS_FAILED)->get()->groupBy('ai_action_execution_row_id');
        foreach ($execRows as $execRow) {
            if (isset($resolved[$execRow->row_id])) {
                continue;
            }
            $previewRow = $previewRows[$execRow->row_id] ?? [];
            if ($execRow->status === AiActionExecutionRow::STATUS_FAILED) {
                // A transient failure can still be retried under the live approval; repair is for what retry cannot fix.
                if ($execRow->retryable && $approvalActive) {
                    $retryPending++;
                    continue;
                }
                $rows[] = $this->candidate('row', $execRow, $previewRow, $proposalRows[$execRow->row_id] ?? [], [
                    'code' => (string) $execRow->error_code, 'message' => (string) $execRow->error_message, 'retryable' => (bool) $execRow->retryable,
                ]);
            } elseif ($execRow->status === AiActionExecutionRow::STATUS_SUCCESS && $failedImages->has($execRow->id)) {
                $stuck = $failedImages[$execRow->id]->filter(fn (AiActionExecutionImage $i): bool => ! ($i->retryable && $approvalActive));
                if ($stuck->isEmpty()) {
                    $retryPending++;
                    continue;
                }
                $first = $stuck->first();
                $rows[] = $this->candidate('images', $execRow, $previewRow, $proposalRows[$execRow->row_id] ?? [], [
                    'code' => (string) $first->error_code, 'message' => (string) $first->error_message, 'retryable' => (bool) $first->retryable,
                ]);
            }
        }

        $reason = null;
        if ($rows === []) {
            $reason = $retryPending > 0
                ? 'الصفوف الفاشلة قابلة لإعادة المحاولة بالموافقة الحالية؛ استخدم «إعادة المحاولة» بدل الإصلاح.'
                : 'لا توجد صفوف فاشلة تحتاج إصلاحاً.';
        }

        return ['rows' => $rows, 'retry_pending' => $retryPending, 'open_repair' => $open, 'reason' => $reason];
    }

    /**
     * @param  array<string,mixed>  $previewRow
     * @param  array<string,mixed>  $proposalRow
     * @param  array{code:string,message:string,retryable:bool}  $failure
     * @return array<string,mixed>
     */
    private function candidate(string $kind, AiActionExecutionRow $execRow, array $previewRow, array $proposalRow, array $failure): array
    {
        [$fields, $scope] = $this->affected($kind, $failure['code'], $previewRow, $proposalRow);
        $imageIds = [];
        foreach ($previewRow['images']['items'] ?? [] as $item) {
            if (is_array($item['image'] ?? null)) {
                $imageIds[] = (string) $item['image']['id'];
            }
        }

        return [
            'row_id' => $execRow->row_id, 'source_row' => (int) $execRow->source_row, 'kind' => $kind, 'operation' => $execRow->operation,
            'display' => $previewRow['display'] ?? null, 'failure' => $failure, 'affected_fields' => $fields, 'scope' => $scope,
            'product_id' => $execRow->product_id, 'image_ids' => $imageIds,
        ];
    }

    /**
     * The fields tied to a failure: those its code points at, plus any field the approved preview itself flagged for the row.
     * A failure that is not about data (a transient error) allows no field edit at all — the row is just re-validated and re-approved.
     * A domain rule that names no field opens the row's own fields (never the identifier) and says so.
     *
     * @param  array<string,mixed>  $previewRow
     * @param  array<string,mixed>  $proposalRow
     * @return array{0:list<string>,1:string}
     */
    private function affected(string $kind, string $code, array $previewRow, array $proposalRow): array
    {
        if ($kind === 'images') {
            return [self::IMAGE_FIELDS, 'fields'];
        }
        if ($code === 'rule_rejected') {
            $present = array_values(array_filter(array_keys($proposalRow['fields'] ?? []), static fn (string $f): bool => ProductImportFields::get($f) !== null && $f !== 'nebrax_id' && ! in_array($f, self::IMAGE_FIELDS, true)));

            return [$present, 'all'];
        }
        $fields = self::CODE_FIELDS[$code] ?? [];
        foreach ($previewRow['issues'] ?? [] as $issue) {
            if (is_string($issue['field'] ?? null) && ProductImportFields::get($issue['field']) !== null) {
                $fields[] = $issue['field'];
            }
        }

        return [array_values(array_unique($fields)), $fields === [] ? 'none' : 'fields'];
    }

    /**
     * A product that was saved but lost an image becomes an UPDATE row aimed at that exact product, carrying only the
     * image sources — and the "add images to this existing product" decision stays off until the reviewer turns it on.
     *
     * @param  array<string,mixed>  $source
     * @param  array<string,mixed>  $candidate
     * @return array<string,mixed>
     */
    private function imageRow(array $source, array $candidate): array
    {
        $fields = [];
        foreach (['sku', 'barcode', 'name', 'primary_image_url', 'additional_image_urls'] as $key) {
            if (isset($source['fields'][$key])) {
                $fields[$key] = $source['fields'][$key];
            }
        }
        $fields['nebrax_id'] = ['value' => (string) $candidate['product_id'], 'origin' => 'erp_existing', 'confidence' => 100];
        $primary = $fields['primary_image_url']['value'] ?? null;
        $raw = $fields['additional_image_urls']['value'] ?? null;
        $additional = $raw === null ? [] : array_values(array_filter(array_map('trim', preg_split('/[;|\r\n]+/', (string) $raw) ?: [])));

        return [
            'row_id' => (string) $source['row_id'], 'source_row' => (int) $source['source_row'],
            'match' => ['kind' => 'nebrax_id', 'value' => (string) $candidate['product_id'], 'target_product_id' => (string) $candidate['product_id'], 'target_version' => null],
            'decision' => 'update', 'fields' => $fields, 'violations' => [],
            'media' => $primary === null && $additional === [] ? null : [
                'primary' => $primary === null ? null : ['kind' => 'url', 'value' => (string) $primary, 'sha256' => null],
                'additional' => array_map(static fn (string $url): array => ['kind' => 'url', 'value' => $url, 'sha256' => null], array_slice($additional, 0, 7)),
                'existing_update_approved' => false,
            ],
        ];
    }

    private function execution(AiAction $origin, string $executionId): AiActionExecution
    {
        $execution = Str::isUuid($executionId) ? AiActionExecution::query()->where('ai_action_id', $origin->id)->whereKey($executionId)->first() : null;
        if ($execution === null) {
            throw new AiActionException('execution_not_found', 'لا يوجد تنفيذ لهذه العملية.', 404);
        }

        return $execution;
    }

    private function assertProductImport(AiAction $action): void
    {
        if ($action->type !== AiActionRegistry::PRODUCT_IMPORT) {
            throw new AiActionException('action_type_invalid', 'الإصلاح مدعوم لاستيراد المنتجات فقط.', 422);
        }
    }

    /** @param array<string,mixed> $metadata */
    private function event(AiAction $action, string $event, User $actor, array $metadata): void
    {
        AiActionEvent::create([
            'ai_action_id' => $action->id, 'version' => $action->version, 'event' => $event, 'from_status' => $action->status, 'to_status' => $action->status,
            'actor_id' => $actor->id, 'metadata' => $metadata, 'occurred_at' => now('UTC'),
        ]);
    }
}
