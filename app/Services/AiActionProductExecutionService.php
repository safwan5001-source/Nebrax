<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionApproval;
use App\Models\AiActionEvent;
use App\Models\AiActionExecution;
use App\Models\AiActionExecutionImage;
use App\Models\AiActionExecutionRow;
use App\Models\AiActionImage;
use App\Models\AiActionPreview;
use App\Models\BarcodeRegistryEntry;
use App\Models\Brand;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\ProductMedia;
use App\Models\User;
use App\Support\AiActionCanonicalJson;
use App\Support\AiActionCostVisibility;
use App\Support\AiActionException;
use App\Support\ProductImportFields;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * AI-ACTIONS-05: applies exactly the approved preview to the product catalogue.
 *
 * It never reads the editable proposal: every value comes from the immutable preview the user
 * approved (re-proven against its approval hash). Writes go through `ProductService::create`
 * (no SKU generation) and `ProductLifecycleService::update` — the same canonical paths as the
 * product screens — one transaction per row, so a failed row neither rolls back nor repeats a
 * successful one. It writes no stock movement and no ledger entry, and never defaults a price,
 * tax or unit. Image import and unit templates are deferred and reported as such.
 */
final class AiActionProductExecutionService
{
    private const OPERATIONS = ['create', 'update', 'skip'];
    private const SCALAR_FIELDS = [
        'name', 'name_en', 'sku', 'type', 'unit', 'barcode', 'sale_price', 'purchase_price', 'min_sale_price',
        'tax_rate', 'track_inventory', 'reorder_level', 'tags', 'description', 'internal_notes', 'is_active',
    ];
    private const DEFERRED_FIELDS = ['images', 'unit_template'];
    private const MANAGED = ['category' => 'التصنيف', 'brand' => 'العلامة التجارية'];

    public function __construct(
        private readonly AiActionGateway $gateway,
        private readonly AiActionProductApprovalService $approvals,
        private readonly AiActionApprovalLedger $ledger,
        private readonly ProductService $products,
        private readonly ProductLifecycleService $lifecycle,
        private readonly AiActionProductImageStager $stager,
        private readonly ProductMediaService $media,
        private readonly ProductImageInspector $inspector,
        private readonly TenantContext $tenantContext,
        private readonly BranchContext $branchContext,
        private readonly AiActionsAccessResolver $controls,
    ) {}

    /**
     * Starts the execution of the approved preview, or — when one already exists for this action —
     * continues it / returns its recorded result. It never creates a second execution.
     *
     * @return array{execution:AiActionExecution,replayed:bool}
     */
    public function run(User $requestActor, AiAction $action, int $expectedVersion): array
    {
        $this->assertEnabled();
        $actor = $this->gateway->authorizeFor($requestActor, $action, AiActionPolicy::APPROVE);
        $this->assertProductImport($action);
        $this->controls->assertAllowed($this->tenantContext->id(), $action->type, AiActionsAccessResolver::EXECUTION);
        $action = $this->ledger->expireIfDue($action);

        $outcome = DB::transaction(function () use ($action, $expectedVersion, $actor): array {
            $locked = AiAction::query()->whereKey($action->id)->lockForUpdate()->firstOrFail();
            $existing = AiActionExecution::query()->where('ai_action_id', $locked->id)->first();
            if ($existing !== null) {
                $this->assertOwner($existing->started_by, $actor);

                return ['execution' => $existing, 'replayed' => true];
            }
            if ($locked->status !== AiAction::STATUS_APPROVED) {
                throw new AiActionException('state_conflict', 'لا توجد موافقة سارية لهذه العملية؛ أنشئ معاينة ووافق عليها أولاً.', 409);
            }
            if ($locked->version !== $expectedVersion) {
                throw new AiActionException('version_conflict', 'تغيّرت المسودة منذ الموافقة.', 409);
            }

            [$approval, $preview] = $this->approvedPreview($locked, $actor);
            $this->assertCostAuthority($actor, $preview);

            // Nothing has been written yet: any drift in the catalogue or the draft since the approval blocks the run.
            [, $hash] = $this->approvals->compute($locked);
            if (! hash_equals($approval->preview_hash, $hash)) {
                $this->ledger->invalidate($locked, $actor, 'live_state_changed');
                $locked->forceFill(['status' => AiAction::STATUS_EDITING])->save();
                $this->event($locked, 'execution_blocked_stale', AiAction::STATUS_APPROVED, AiAction::STATUS_EDITING, $actor, ['preview_id' => $preview->id]);

                return ['stale' => true];
            }

            $execution = AiActionExecution::create([
                'ai_action_id' => $locked->id, 'ai_action_approval_id' => $approval->id, 'ai_action_preview_id' => $preview->id,
                'action_version' => $locked->version, 'branch_id' => $this->branchContext->id(), 'preview_hash' => $approval->preview_hash,
                'started_by' => $actor->id, 'status' => AiActionExecution::STATUS_RUNNING, 'started_at' => now('UTC'),
            ]);
            $total = 0;
            foreach ($preview->preview['rows'] ?? [] as $row) {
                if (! in_array($row['operation'] ?? null, self::OPERATIONS, true)) {
                    continue;
                }
                $skipped = $row['operation'] === 'skip';
                $created = AiActionExecutionRow::create([
                    'ai_action_execution_id' => $execution->id, 'ai_action_id' => $locked->id, 'row_id' => (string) $row['row_id'],
                    'source_row' => (int) $row['source_row'], 'operation' => $row['operation'],
                    'status' => $skipped ? AiActionExecutionRow::STATUS_SKIPPED : AiActionExecutionRow::STATUS_PENDING,
                    'finished_at' => $skipped ? now('UTC') : null,
                ]);
                // One result record per approved image — separate from the product's own row.
                foreach ($skipped ? [] : ($row['images']['items'] ?? []) as $item) {
                    if (($item['status'] ?? null) !== 'ready' || ! is_array($item['image'] ?? null)) {
                        continue;
                    }
                    AiActionExecutionImage::create([
                        'ai_action_execution_id' => $execution->id, 'ai_action_execution_row_id' => $created->id, 'ai_action_id' => $locked->id,
                        'item_key' => (string) $item['key'], 'ai_action_image_id' => (string) $item['image']['id'],
                        'content_sha256' => (string) $item['image']['sha256'], 'role' => (string) $item['role'],
                        'position' => (int) $item['position'], 'status' => AiActionExecutionImage::STATUS_PENDING,
                    ]);
                }
                $total++;
            }
            $locked->forceFill(['status' => AiAction::STATUS_EXECUTING])->save();
            $this->event($locked, 'execution_started', AiAction::STATUS_APPROVED, AiAction::STATUS_EXECUTING, $actor, [
                'execution_id' => $execution->id, 'approval_id' => $approval->id, 'preview_id' => $preview->id,
                'preview_hash' => $approval->preview_hash, 'rows' => $total,
            ]);

            return ['execution' => $execution, 'replayed' => false];
        }, 3);

        if (isset($outcome['stale'])) {
            throw new AiActionException('approval_stale', 'تغيّرت بيانات المنتجات منذ الموافقة؛ أُبطلت الموافقة ولم يُنفَّذ شيء. أنشئ معاينة جديدة وراجعها.', 409);
        }

        return ['execution' => $this->process($actor, $outcome['execution']), 'replayed' => $outcome['replayed']];
    }

    /** Re-runs only the failed rows that are retryable, under a still-valid approval of the same user. */
    public function retry(User $requestActor, AiAction $action, string $executionId): AiActionExecution
    {
        $this->assertEnabled();
        $actor = $this->gateway->authorizeFor($requestActor, $action, AiActionPolicy::APPROVE);
        $this->assertProductImport($action);
        $this->controls->assertAllowed($this->tenantContext->id(), $action->type, AiActionsAccessResolver::EXECUTION);
        $execution = $this->find($action, $executionId);

        DB::transaction(function () use ($action, $execution, $actor): void {
            $locked = AiAction::query()->whereKey($action->id)->lockForUpdate()->firstOrFail();
            $fresh = AiActionExecution::query()->whereKey($execution->id)->lockForUpdate()->firstOrFail();
            $this->assertOwner($fresh->started_by, $actor);
            if (! in_array($fresh->status, [AiActionExecution::STATUS_PARTIALLY_FAILED, AiActionExecution::STATUS_FAILED], true)) {
                throw new AiActionException('retry_not_available', 'لا توجد صفوف فاشلة قابلة لإعادة المحاولة في حالة التنفيذ الحالية.', 409);
            }
            $approval = AiActionApproval::query()->whereKey($fresh->ai_action_approval_id)->firstOrFail();
            if (! $approval->isActive()) {
                throw new AiActionException('approval_expired', 'انتهت صلاحية الموافقة؛ لا يُعاد التنفيذ بموافقة منتهية. أنشئ استيراداً جديداً.', 409);
            }
            $preview = AiActionPreview::query()->whereKey($fresh->ai_action_preview_id)->firstOrFail();
            $this->assertCostAuthority($actor, $preview);

            $reset = AiActionExecutionRow::query()->where('ai_action_execution_id', $fresh->id)
                ->where('status', AiActionExecutionRow::STATUS_FAILED)->where('retryable', true)
                ->update(['status' => AiActionExecutionRow::STATUS_PENDING, 'updated_at' => now('UTC')]);
            // A failed image of an already-saved product is retried alone: the product is never touched again.
            $reset += AiActionExecutionImage::query()->where('ai_action_execution_id', $fresh->id)
                ->where('status', AiActionExecutionImage::STATUS_FAILED)->where('retryable', true)
                ->update(['status' => AiActionExecutionImage::STATUS_PENDING, 'updated_at' => now('UTC')]);
            if ($reset === 0) {
                throw new AiActionException('nothing_to_retry', 'كل الصفوف الفاشلة غير قابلة لإعادة المحاولة؛ راجع رسالة كل صف.', 409);
            }
            $fresh->forceFill(['status' => AiActionExecution::STATUS_RUNNING, 'retry_count' => $fresh->retry_count + 1, 'finished_at' => null])->save();
            $from = $locked->status;
            $locked->forceFill(['status' => AiAction::STATUS_EXECUTING])->save();
            $this->event($locked, 'execution_retry_requested', $from, AiAction::STATUS_EXECUTING, $actor, ['execution_id' => $fresh->id, 'rows' => $reset]);
        }, 3);

        return $this->process($actor, $execution->refresh());
    }

    public function find(AiAction $action, ?string $executionId): AiActionExecution
    {
        $query = AiActionExecution::query()->where('ai_action_id', $action->id);
        $execution = $executionId === null ? $query->orderByDesc('created_at')->first() : (Str::isUuid($executionId) ? $query->whereKey($executionId)->first() : null);
        if ($execution === null) {
            throw new AiActionException('execution_not_found', 'لا يوجد تنفيذ لهذه العملية.', 404);
        }

        return $execution;
    }

    public function show(User $requestActor, AiAction $action, ?string $executionId): AiActionExecution
    {
        $this->gateway->authorizeFor($requestActor, $action, AiActionPolicy::USE);
        $this->assertProductImport($action);

        return $this->find($action, $executionId);
    }

    /**
     * @param  array{status?:mixed,page?:mixed,per_page?:mixed}  $query
     * @return array<string,mixed>
     */
    public function present(AiActionExecution $execution, User $actor, array $query = []): array
    {
        $counts = AiActionExecutionRow::query()->where('ai_action_execution_id', $execution->id)
            ->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $retryable = AiActionExecutionRow::query()->where('ai_action_execution_id', $execution->id)
            ->where('status', AiActionExecutionRow::STATUS_FAILED)->where('retryable', true)->count();
        $retryableImages = AiActionExecutionImage::query()->where('ai_action_execution_id', $execution->id)
            ->where('status', AiActionExecutionImage::STATUS_FAILED)->where('retryable', true)->count();
        $imageCounts = AiActionExecutionImage::query()->where('ai_action_execution_id', $execution->id)
            ->whereIn('ai_action_execution_row_id', $this->savedRowIds($execution))
            ->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $waitingImages = AiActionExecutionImage::query()->where('ai_action_execution_id', $execution->id)
            ->whereNotIn('ai_action_execution_row_id', $this->savedRowIds($execution))->count();
        $status = in_array($query['status'] ?? null, ['pending', 'success', 'failed', 'skipped'], true) ? $query['status'] : null;
        $perPage = min(500, max(1, (int) ($query['per_page'] ?? config('ai_actions.preview_page_size', 100))));
        $page = max(1, (int) ($query['page'] ?? 1));
        $rowsQuery = AiActionExecutionRow::query()->where('ai_action_execution_id', $execution->id)->when($status, fn ($q) => $q->where('status', $status));
        $total = (clone $rowsQuery)->count();
        $display = [];
        $planned = [];
        foreach (AiActionPreview::query()->whereKey($execution->ai_action_preview_id)->value('preview')['rows'] ?? [] as $row) {
            $display[(string) $row['row_id']] = $row['display'] ?? null;
            $planned[(string) $row['row_id']] = $row['images']['items'] ?? [];
        }
        $pageRows = $rowsQuery->orderBy('source_row')->forPage($page, $perPage)->get();
        $results = AiActionExecutionImage::query()->whereIn('ai_action_execution_row_id', $pageRows->pluck('id')->all())->get()->groupBy('ai_action_execution_row_id');
        $count = static fn (string $key): int => (int) ($counts[$key] ?? 0);
        $approval = AiActionApproval::query()->whereKey($execution->ai_action_approval_id)->first();

        return [
            'id' => $execution->id,
            'action_id' => $execution->ai_action_id,
            'action_version' => (int) $execution->action_version,
            'status' => $execution->status,
            'preview_hash' => $execution->preview_hash,
            'started_by' => $execution->started_by,
            'started_at' => optional($execution->started_at)->toIso8601String(),
            'finished_at' => optional($execution->finished_at)->toIso8601String(),
            'retry_count' => (int) $execution->retry_count,
            'progress' => [
                'total' => array_sum($counts->all()), 'pending' => $count('pending'), 'success' => $count('success'),
                'failed' => $count('failed'), 'skipped' => $count('skipped'),
            ],
            'images' => [
                'total' => array_sum($imageCounts->all()), 'pending' => (int) ($imageCounts['pending'] ?? 0), 'success' => (int) ($imageCounts['success'] ?? 0),
                'failed' => (int) ($imageCounts['failed'] ?? 0), 'skipped' => (int) ($imageCounts['skipped'] ?? 0), 'waiting_for_product' => $waitingImages,
            ],
            // Deferred by design: reported, never claimed as imported.
            'deferred' => ['unit_template' => 'deferred'],
            'rows' => $pageRows->map(fn (AiActionExecutionRow $row): array => [
                'row_id' => $row->row_id, 'source_row' => (int) $row->source_row, 'operation' => $row->operation, 'status' => $row->status,
                'product_id' => $row->product_id, 'error_code' => $row->error_code, 'error_message' => $row->error_message,
                'retryable' => (bool) $row->retryable, 'attempts' => (int) $row->attempts,
                'changed_fields' => $row->changed_fields ?? [], 'deferred' => $row->deferred ?? [],
                'display' => $display[$row->row_id] ?? null,
                'images' => $this->presentImages($planned[$row->row_id] ?? [], $results->get($row->id, collect())->keyBy('item_key'), $row->status),
            ])->all(),
            'pagination' => ['page' => $page, 'per_page' => $perPage, 'total' => $total, 'last_page' => max(1, (int) ceil($total / $perPage)), 'status' => $status],
            'permissions' => [
                'can_continue' => $execution->status === AiActionExecution::STATUS_RUNNING && $execution->started_by === $actor->id,
                'can_retry' => in_array($execution->status, [AiActionExecution::STATUS_PARTIALLY_FAILED, AiActionExecution::STATUS_FAILED], true)
                    && ($retryable + $retryableImages) > 0 && $execution->started_by === $actor->id && $approval?->isActive() === true,
                'retryable_rows' => $retryable,
                'retryable_images' => $retryableImages,
            ],
        ];
    }

    /**
     * Every image the approved preview named for a row — applied or not — with the outcome of each: an image the
     * preview never intended to apply (duplicate, unavailable, no decision) is shown with its reason, not hidden.
     *
     * @param  list<array<string,mixed>>  $items
     * @param  \Illuminate\Support\Collection<string,AiActionExecutionImage>  $results
     * @return list<array<string,mixed>>
     */
    private function presentImages(array $items, $results, string $rowStatus): array
    {
        $out = [];
        foreach ($items as $item) {
            $result = $results->get($item['key']);
            // An image waits for its product: if the product failed, say so instead of showing a perpetual "pending".
            $orphaned = $rowStatus === AiActionExecutionRow::STATUS_FAILED && ($result === null || $result->status === AiActionExecutionImage::STATUS_PENDING) && ($item['status'] ?? null) === 'ready';
            $out[] = $orphaned ? [
                'key' => $item['key'], 'role' => $item['role'], 'position' => (int) $item['position'], 'source' => $item['source'], 'image_id' => $item['image']['id'] ?? null,
                'status' => 'skipped', 'error_code' => 'product_not_saved', 'error_message' => 'لم تُعالَج الصورة لأن المنتج لم يُحفظ.',
                'retryable' => false, 'attempts' => 0, 'product_media_id' => null,
            ] : [
                'key' => $item['key'], 'role' => $item['role'], 'position' => (int) $item['position'],
                'source' => $item['source'], 'image_id' => $item['image']['id'] ?? null,
                'status' => $result?->status ?? (($item['status'] ?? null) === 'ready' ? 'pending' : $item['status']),
                'error_code' => $result?->error_code ?? ($result === null ? ($item['code'] ?? null) : null),
                'error_message' => $result?->error_message ?? ($result === null ? ($item['message'] ?? null) : null),
                'retryable' => (bool) ($result?->retryable ?? false), 'attempts' => (int) ($result?->attempts ?? 0),
                'product_media_id' => $result?->product_media_id,
            ];
        }

        return $out;
    }

    /** Applies one batch of pending rows under an exclusive lease, then finalises when none are left. */
    private function process(User $actor, AiActionExecution $execution): AiActionExecution
    {
        if ($execution->status !== AiActionExecution::STATUS_RUNNING) {
            return $execution;
        }
        $token = Str::random(32);
        $now = now('UTC');
        $claimed = AiActionExecution::query()->whereKey($execution->id)->where('status', AiActionExecution::STATUS_RUNNING)
            ->where(fn ($q) => $q->whereNull('locked_until')->orWhere('locked_until', '<', $now))
            ->update(['claim_token' => $token, 'locked_until' => $now->copy()->addSeconds(max(10, (int) config('ai_actions.execution_lease_seconds', 120))), 'updated_at' => $now]);
        if ($claimed !== 1) {
            throw new AiActionException('execution_in_progress', 'هذا التنفيذ قيد المعالجة الآن؛ لا يُشغَّل مرتين بالتزامن. حدّث الحالة بعد قليل.', 409);
        }

        try {
            $preview = AiActionPreview::query()->whereKey($execution->ai_action_preview_id)->firstOrFail();
            $rows = [];
            foreach ($preview->preview['rows'] ?? [] as $row) {
                $rows[(string) $row['row_id']] = $row;
            }
            $batch = AiActionExecutionRow::query()->where('ai_action_execution_id', $execution->id)
                ->where('status', AiActionExecutionRow::STATUS_PENDING)->orderBy('source_row')
                ->limit(max(1, (int) config('ai_actions.execution_batch_rows', 200)))->get();
            $done = ['success' => 0, 'failed' => 0];
            foreach ($batch as $result) {
                // IMP-X-01b: إيقاف المشغّل أثناء التنفيذ يسري خلال صفٍّ واحد — قراءة واحدة قبل كل كتابة؛ لا يُكتب صفٌّ بعد الإيقاف ولا تُكتب صور،
                // والصفوف المتبقية تبقى «معلّقة» فيُستأنف التنفيذ بـ`run()` لاحقاً عند رفع الإيقاف (لا نصف صفٍّ أبداً: كل صف بمعاملته).
                $this->controls->assertAllowed($this->tenantContext->id(), AiActionRegistry::PRODUCT_IMPORT, AiActionsAccessResolver::EXECUTION);
                $done[$this->executeRow($actor, $result, $rows[$result->row_id] ?? null) ? 'success' : 'failed']++;
            }
            $this->controls->assertAllowed($this->tenantContext->id(), AiActionRegistry::PRODUCT_IMPORT, AiActionsAccessResolver::EXECUTION);
            // Images follow their (already saved) product, each with its own result — a failed image never
            // changes the product row, and a saved product is never written again for the sake of an image.
            $pendingImages = AiActionExecutionImage::query()->where('ai_action_execution_id', $execution->id)
                ->where('status', AiActionExecutionImage::STATUS_PENDING)
                ->whereIn('ai_action_execution_row_id', $this->savedRowIds($execution))
                ->orderBy('ai_action_execution_row_id')->orderBy('position')
                ->limit(max(1, (int) config('ai_actions.execution_batch_images', 50)))->get();
            $execRows = AiActionExecutionRow::query()->whereIn('id', $pendingImages->pluck('ai_action_execution_row_id')->unique()->all())->get()->keyBy('id');
            foreach ($pendingImages as $image) {
                $execRow = $execRows[$image->ai_action_execution_row_id] ?? null;
                $this->applyImage($actor, $image, $execRow, $execRow === null ? null : ($rows[$execRow->row_id] ?? null));
            }
            $this->finish($actor, $execution, $done);
        } finally {
            AiActionExecution::query()->whereKey($execution->id)->where('claim_token', $token)->update(['claim_token' => null, 'locked_until' => null]);
        }

        return $execution->refresh();
    }

    /** @param array<string,mixed>|null $previewRow */
    private function executeRow(User $actor, AiActionExecutionRow $result, ?array $previewRow): bool
    {
        try {
            DB::transaction(function () use ($actor, $result, $previewRow): void {
                $row = AiActionExecutionRow::query()->whereKey($result->id)->lockForUpdate()->firstOrFail();
                if ($row->status !== AiActionExecutionRow::STATUS_PENDING) {
                    return; // already finished by an earlier attempt: never re-run it
                }
                if ($previewRow === null || ! in_array($previewRow['operation'] ?? null, ['create', 'update'], true)) {
                    throw new AiActionRowFailure('preview_row_missing', 'صف المعاينة المعتمد غير متاح.', false);
                }
                [$attributes, $changed] = $this->attributes($previewRow);
                $product = $previewRow['operation'] === 'create'
                    ? $this->createProduct($actor, $attributes)
                    : $this->updateProduct($actor, $previewRow, $attributes);
                $row->forceFill([
                    'status' => AiActionExecutionRow::STATUS_SUCCESS, 'product_id' => $product->id, 'attempts' => $row->attempts + 1,
                    'changed_fields' => $changed, 'deferred' => $this->deferred($previewRow), 'error_code' => null, 'error_message' => null,
                    'retryable' => false, 'started_at' => $row->started_at ?? now('UTC'), 'finished_at' => now('UTC'),
                ])->save();
            });

            return true;
        } catch (Throwable $e) {
            [$code, $message, $retryable] = $this->classify($e);
            // The row transaction rolled back; record the failure in its own short transaction.
            DB::transaction(function () use ($result, $code, $message, $retryable): void {
                $row = AiActionExecutionRow::query()->whereKey($result->id)->lockForUpdate()->firstOrFail();
                if ($row->status === AiActionExecutionRow::STATUS_PENDING) {
                    $row->forceFill([
                        'status' => AiActionExecutionRow::STATUS_FAILED, 'attempts' => $row->attempts + 1, 'error_code' => $code,
                        'error_message' => $message, 'retryable' => $retryable, 'started_at' => $row->started_at ?? now('UTC'), 'finished_at' => now('UTC'),
                    ])->save();
                }
            });

            return false;
        }
    }

    /** @param array<string,mixed> $attributes */
    private function createProduct(User $actor, array $attributes): Product
    {
        $sku = $attributes['sku'] ?? null;
        $barcode = $attributes['barcode'] ?? null;
        if (($sku !== null && Product::query()->where('sku', $sku)->exists()) || ($barcode !== null && BarcodeRegistryEntry::isTaken((string) $barcode))) {
            throw new AiActionRowFailure('conflict_existing_product', 'يوجد الآن منتج بالرمز أو الباركود نفسه؛ لم يُنشأ المنتج.', false);
        }

        // No SKU generation: an identifier is explicit or absent, never invented.
        return $this->products->create($attributes, $actor->id, generateSku: false);
    }

    /**
     * @param  array<string,mixed>  $previewRow
     * @param  array<string,mixed>  $attributes
     */
    private function updateProduct(User $actor, array $previewRow, array $attributes): Product
    {
        $match = $previewRow['match'] ?? [];
        $product = Product::query()->lockForUpdate()->find($match['target_product_id'] ?? null);
        if ($product === null) {
            throw new AiActionRowFailure('target_not_found', 'المنتج المستهدف لم يعد موجوداً في نطاقك.', false);
        }
        // The product must be exactly the version the user saw and approved.
        if ($product->updated_at?->clone()->utc()->format('Y-m-d\TH:i:s.u\Z') !== ($match['target_version'] ?? null)) {
            throw new AiActionRowFailure('target_changed', 'تغيّر المنتج منذ المعاينة؛ لم يُحدَّث. أنشئ استيراداً جديداً.', false);
        }
        if (isset($attributes['sku']) && $attributes['sku'] !== $product->sku && Product::query()->where('sku', $attributes['sku'])->where('id', '!=', $product->id)->exists()) {
            throw new AiActionRowFailure('conflict_existing_product', 'رمز الصنف الجديد مستخدم لمنتج آخر.', false);
        }
        if (isset($attributes['barcode']) && BarcodeRegistryEntry::isTaken((string) $attributes['barcode'], $product->id)) {
            throw new AiActionRowFailure('conflict_existing_product', 'الباركود الجديد مستخدم لمنتج آخر.', false);
        }

        // An image-only update leaves the product record alone: its images are attached by their own results.
        if ($attributes === []) {
            return $product;
        }

        return $this->lifecycle->update($product, $attributes, $actor->id);
    }

    /**
     * Preview changes ⇒ product attributes. Values are the approved, typed ones. A category or brand is the
     * exact id the user approved (`references`), re-verified against the live record just before the write —
     * it is never re-resolved by name, never replaced by another record and never degraded to free text.
     *
     * @param  array<string,mixed>  $previewRow
     * @return array{0:array<string,mixed>,1:list<string>}
     */
    private function attributes(array $previewRow): array
    {
        $attributes = [];
        $changed = [];
        foreach ($previewRow['changes'] ?? [] as $change) {
            $field = (string) ($change['field'] ?? '');
            if (in_array($field, self::SCALAR_FIELDS, true)) {
                $attributes[$field] = $change['after'] ?? null;
            } elseif (isset(self::MANAGED[$field])) {
                $reference = $previewRow['references'][$field] ?? null;
                if (! is_array($reference) || ! is_string($reference['id'] ?? null)) {
                    throw new AiActionRowFailure('reference_missing', 'مرجع '.self::MANAGED[$field].' المعتمد غير متاح في المعاينة؛ لم يُنفَّذ الصف.', false);
                }
                $this->assertReferenceUnchanged($field, $reference);
                $attributes["{$field}_id"] = $reference['id'];
                $attributes[$field] = null; // the id is the source of truth; no parallel free-text copy
            } else {
                continue; // unknown or deferred field: never applied
            }
            $changed[] = $field;
        }

        return [$attributes, $changed];
    }

    /**
     * The record must still be the one that was approved: same id, tenant/branch-visible, same name, and the
     * name must still be unambiguous. Anything else fails this row before it writes.
     *
     * @param  array{id:string,name?:string}  $reference
     */
    private function assertReferenceUnchanged(string $field, array $reference): void
    {
        $label = self::MANAGED[$field];
        $model = $field === 'category' ? ProductCategory::class : Brand::class;
        $record = $model::query()->whereKey($reference['id'])->first(['id', 'name']);
        $needle = mb_strtolower(trim((string) ($reference['name'] ?? '')), 'UTF-8');
        if ($record === null || mb_strtolower(trim((string) $record->name), 'UTF-8') !== $needle) {
            throw new AiActionRowFailure('reference_changed', "«{$label}» المعتمد حُذف أو أُعيدت تسميته منذ الموافقة؛ لم يُنفَّذ الصف ولم يُستبدل بغيره.", false);
        }
        if ($model::query()->get(['id', 'name'])->filter(fn ($item) => mb_strtolower(trim((string) $item->name), 'UTF-8') === $needle)->count() !== 1) {
            throw new AiActionRowFailure('reference_changed', "«{$label}» صار الاسم المعتمد غامضاً (سجلّات متعدّدة)؛ لم يُنفَّذ الصف.", false);
        }
    }

    /** @param array<string,mixed> $previewRow @return list<string> */
    private function deferred(array $previewRow): array
    {
        $deferred = [];
        // Images are applied now; only a source the platform cannot fetch is reported as not applied.
        foreach ($previewRow['images']['items'] ?? [] as $item) {
            if (($item['status'] ?? null) === 'unavailable') {
                $deferred[] = 'images';
                break;
            }
        }
        foreach ($previewRow['issues'] ?? [] as $issue) {
            if (($issue['code'] ?? null) === 'unit_template_deferred') {
                $deferred[] = 'unit_template';
            }
        }

        return array_values(array_intersect(self::DEFERRED_FIELDS, $deferred));
    }

    /** Sub-query: ids of this execution's rows whose product is already saved. */
    private function savedRowIds(AiActionExecution $execution): \Illuminate\Database\Eloquent\Builder
    {
        return AiActionExecutionRow::query()->where('ai_action_execution_id', $execution->id)
            ->where('status', AiActionExecutionRow::STATUS_SUCCESS)->select('id');
    }

    /**
     * Attaches ONE approved image to the product its row saved. Every guard that protects the product write
     * protects this one too: the bytes must still hash to the approved identity, the gallery is append-only
     * (never replaced or reordered), and a duplicate or full gallery is reported, not forced. The outcome is recorded
     * on the image's own record; the product row is never touched.
     *
     * @param  array<string,mixed>|null  $previewRow
     */
    private function applyImage(User $actor, AiActionExecutionImage $result, ?AiActionExecutionRow $execRow, ?array $previewRow): void
    {
        $file = null;
        // Counted before any side effect: a crash after the attach leaves a visible attempt behind, which is how the
        // next run recognises its own image instead of reporting a duplicate.
        $attempt = $this->beginImage($result);
        try {
            if ($execRow === null || $execRow->product_id === null || $previewRow === null) {
                throw new AiActionRowFailure('preview_row_missing', 'صف المعاينة المعتمد لهذه الصورة غير متاح.', false);
            }
            $item = collect($previewRow['images']['items'] ?? [])->firstWhere('key', $result->item_key);
            if (! is_array($item) || ($item['status'] ?? null) !== 'ready' || ($item['image']['sha256'] ?? null) !== $result->content_sha256) {
                throw new AiActionRowFailure('preview_image_missing', 'الصورة غير موجودة ضمن المعاينة المعتمدة؛ لم تُرفق.', false);
            }
            $product = Product::query()->find($execRow->product_id);
            if ($product === null) {
                throw new AiActionRowFailure('product_unavailable', 'المنتج لم يعد متاحاً في نطاقك؛ لم تُرفق الصورة.', false);
            }
            $staged = $result->ai_action_image_id === null ? null : AiActionImage::query()->where('ai_action_id', $result->ai_action_id)->find($result->ai_action_image_id);
            if ($staged === null || $staged->isPurged() || $staged->content_sha256 !== $result->content_sha256) {
                throw new AiActionRowFailure('image_missing', 'الصورة المعتمدة لم تعد متاحة في التخزين الخاص؛ لم تُرفق.', false);
            }

            // A crash between "attached" and "recorded" must not attach twice: the hash is the idempotency key.
            $present = ProductMedia::query()->where('product_id', $product->id)->where('content_sha256', $result->content_sha256)->first();
            if ($present !== null) {
                $own = $attempt > 1;
                $this->finishImage($result, $own ? AiActionExecutionImage::STATUS_SUCCESS : AiActionExecutionImage::STATUS_SKIPPED, $own ? null : 'already_attached',
                    $own ? null : 'الصورة موجودة بالفعل ضمن صور المنتج؛ لم تُكرَّر.', false, $present->id);

                return;
            }
            $count = ProductMedia::query()->where('product_id', $product->id)->whereNull('product_option_value_id')->whereNull('product_variant_id')->count();
            if ($count >= 8) {
                throw new AiActionRowFailure('gallery_full', 'معرض المنتج بلغ حده الأقصى (8 صور)؛ لم تُرفق الصورة ولم تُستبدل صورة موجودة.', false);
            }

            $file = $this->stager->materialize($staged);
            try {
                $inspected = $this->inspector->inspect($file);
            } catch (Throwable) {
                throw new AiActionRowFailure('image_changed', 'لم يعد محتوى الصورة صالحاً؛ لم تُرفق.', false);
            }
            if ($inspected->sha256 !== $result->content_sha256) {
                throw new AiActionRowFailure('image_changed', 'تغيّر محتوى الصورة منذ الموافقة؛ لم تُرفق.', false);
            }

            try {
                $created = $this->media->attachToProduct($product, [$file], $actor->id, true);
            } catch (Throwable $e) {
                if ($e->getPrevious() instanceof \Illuminate\Database\UniqueConstraintViolationException) {
                    $this->finishImage($result, AiActionExecutionImage::STATUS_SKIPPED, 'already_attached', 'الصورة موجودة بالفعل ضمن صور المنتج؛ لم تُكرَّر.', false, null);

                    return;
                }
                if (str_contains($e->getMessage(), 'تعذّر حفظ الصورة')) {
                    throw new AiActionRowFailure('image_storage_failed', 'تعذّر حفظ الصورة في التخزين؛ يمكن إعادة المحاولة.', true);
                }
                throw $e;
            }
            $this->finishImage($result, AiActionExecutionImage::STATUS_SUCCESS, null, null, false, $created[0]->id ?? null);
        } catch (Throwable $e) {
            [$code, $message, $retryable] = $this->classify($e);
            $this->finishImage($result, AiActionExecutionImage::STATUS_FAILED, $code, $message, $retryable, null);
        } finally {
            if ($file instanceof \Illuminate\Http\UploadedFile && is_file((string) $file->getRealPath())) {
                @unlink((string) $file->getRealPath());
            }
        }
    }

    private function beginImage(AiActionExecutionImage $result): int
    {
        return DB::transaction(function () use ($result): int {
            $row = AiActionExecutionImage::query()->whereKey($result->id)->lockForUpdate()->firstOrFail();
            if ($row->status !== AiActionExecutionImage::STATUS_PENDING) {
                return (int) $row->attempts;
            }
            $row->forceFill(['attempts' => $row->attempts + 1, 'started_at' => $row->started_at ?? now('UTC')])->save();

            return (int) $row->attempts;
        });
    }

    private function finishImage(AiActionExecutionImage $result, string $status, ?string $code, ?string $message, bool $retryable, ?string $mediaId): void
    {
        DB::transaction(function () use ($result, $status, $code, $message, $retryable, $mediaId): void {
            $row = AiActionExecutionImage::query()->whereKey($result->id)->lockForUpdate()->firstOrFail();
            if ($row->status !== AiActionExecutionImage::STATUS_PENDING) {
                return; // finished by an earlier attempt: never rewritten
            }
            $row->forceFill([
                'status' => $status, 'error_code' => $code, 'error_message' => $message === null ? null : mb_substr($message, 0, 500),
                'retryable' => $retryable, 'product_media_id' => $mediaId, 'finished_at' => now('UTC'),
            ])->save();
        });
    }

    /** @return array{0:string,1:string,2:bool} [code, safe message, retryable] */
    private function classify(Throwable $e): array
    {
        if ($e instanceof AiActionRowFailure) {
            return [$e->reason, $e->getMessage(), $e->retryable];
        }
        if ($e instanceof QueryException) {
            return ['database_conflict', 'تعذر تنفيذ الصف بسبب تعارض في قاعدة البيانات؛ يمكن إعادة المحاولة.', true];
        }
        if ($e instanceof \RuntimeException) {
            return ['rule_rejected', mb_substr($e->getMessage(), 0, 500), false];
        }
        report($e);

        return ['internal_error', 'تعذر تنفيذ الصف بسبب خطأ غير متوقع؛ يمكن إعادة المحاولة.', true];
    }

    /** @param array{success:int,failed:int} $done */
    private function finish(User $actor, AiActionExecution $execution, array $done): void
    {
        DB::transaction(function () use ($actor, $execution, $done): void {
            $locked = AiAction::query()->whereKey($execution->ai_action_id)->lockForUpdate()->firstOrFail();
            $counts = AiActionExecutionRow::query()->where('ai_action_execution_id', $execution->id)
                ->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
            $imageCounts = AiActionExecutionImage::query()->where('ai_action_execution_id', $execution->id)
                ->whereIn('ai_action_execution_row_id', $this->savedRowIds($execution))
                ->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
            // Images of a product that has not been saved yet wait for it and do not hold the run open.
            $pending = (int) ($counts['pending'] ?? 0) + (int) ($imageCounts['pending'] ?? 0);
            $failedImages = (int) ($imageCounts['failed'] ?? 0);
            $failed = (int) ($counts['failed'] ?? 0);
            $success = (int) ($counts['success'] ?? 0);
            $this->event($locked, 'execution_batch_processed', $locked->status, $locked->status, $actor, [
                'execution_id' => $execution->id, 'success' => $done['success'], 'failed' => $done['failed'], 'pending' => $pending,
            ]);
            if ($pending > 0) {
                return;
            }
            [$executionStatus, $actionStatus] = match (true) {
                $failed === 0 && $failedImages === 0 => [AiActionExecution::STATUS_COMPLETED, AiAction::STATUS_EXECUTED],
                $failed === 0 => [AiActionExecution::STATUS_PARTIALLY_FAILED, AiAction::STATUS_PARTIALLY_FAILED],
                $success > 0 => [AiActionExecution::STATUS_PARTIALLY_FAILED, AiAction::STATUS_PARTIALLY_FAILED],
                default => [AiActionExecution::STATUS_FAILED, AiAction::STATUS_FAILED],
            };
            AiActionExecution::query()->whereKey($execution->id)->update(['status' => $executionStatus, 'finished_at' => now('UTC'), 'updated_at' => now('UTC')]);
            $from = $locked->status;
            $locked->forceFill(['status' => $actionStatus])->save();
            $this->event($locked, 'execution_'.$executionStatus, $from, $actionStatus, $actor, [
                'execution_id' => $execution->id, 'success' => $success, 'failed' => $failed, 'skipped' => (int) ($counts['skipped'] ?? 0),
                'images_success' => (int) ($imageCounts['success'] ?? 0), 'images_failed' => $failedImages, 'images_skipped' => (int) ($imageCounts['skipped'] ?? 0),
            ]);
        }, 3);
    }

    /** @return array{0:AiActionApproval,1:AiActionPreview} */
    private function approvedPreview(AiAction $locked, User $actor): array
    {
        $approval = AiActionApproval::query()->where('ai_action_id', $locked->id)->where('action_version', $locked->version)
            ->whereNull('revoked_at')->orderByDesc('approved_at')->first();
        if ($approval === null) {
            throw new AiActionException('approval_unavailable', 'لا توجد موافقة سارية لهذا الإصدار.', 409);
        }
        if (! $approval->isActive()) {
            throw new AiActionException('approval_expired', 'انتهت صلاحية الموافقة؛ أنشئ معاينة جديدة ووافق عليها.', 409);
        }
        $this->assertOwner($approval->approved_by, $actor);
        $preview = AiActionPreview::query()->where('ai_action_id', $locked->id)->whereKey($approval->ai_action_preview_id)->first();
        if ($preview === null || $preview->invalidated_at !== null || ! $preview->approvable || ! hash_equals($preview->preview_hash, $approval->preview_hash)
            || (int) $preview->action_version !== (int) $locked->version) {
            throw new AiActionException('approval_unavailable', 'الموافقة لا تطابق معاينة صالحة.', 409);
        }
        // The stored preview content must still hash to what the user approved.
        $proof = AiActionCanonicalJson::previewHash((string) $this->tenantContext->id(), $locked->id, $locked->type, (int) $locked->version, $preview->preview);
        if (! hash_equals($proof, $approval->preview_hash)) {
            throw new AiActionException('approval_unavailable', 'محتوى المعاينة لا يطابق بصمة الموافقة.', 409);
        }

        return [$approval, $preview];
    }

    private function assertOwner(string $ownerId, User $actor): void
    {
        if ($ownerId !== $actor->id) {
            throw new AiActionException('approval_owner_mismatch', 'الموافقة والتنفيذ يخصّان مستخدماً آخر؛ لا يُستخدم تفويضه.', 403);
        }
    }

    private function assertCostAuthority(User $actor, AiActionPreview $preview): void
    {
        if (($preview->summary['totals']['has_cost_values'] ?? false) === true && ! AiActionCostVisibility::allows($actor)) {
            throw new AiActionException('cost_permission_required', 'تنفيذ بيانات تتضمن سعر الشراء يتطلب صلاحية عرض التكلفة.', 403);
        }
    }

    private function assertEnabled(): void
    {
        if (config('ai_actions.execution_enabled') !== true) {
            throw new AiActionException('execution_disabled', 'تنفيذ AI Actions غير مفعّل على المنصة.', 403);
        }
    }

    private function assertProductImport(AiAction $action): void
    {
        if ($action->type !== AiActionRegistry::PRODUCT_IMPORT) {
            throw new AiActionException('action_type_invalid', 'التنفيذ مدعوم لاستيراد المنتجات فقط.', 422);
        }
    }

    private function event(AiAction $action, string $event, ?string $from, ?string $to, User $actor, array $metadata = []): void
    {
        AiActionEvent::create([
            'ai_action_id' => $action->id, 'version' => $action->version, 'event' => $event, 'from_status' => $from, 'to_status' => $to,
            'actor_id' => $actor->id, 'metadata' => $metadata === [] ? null : $metadata, 'occurred_at' => now('UTC'),
        ]);
    }
}
