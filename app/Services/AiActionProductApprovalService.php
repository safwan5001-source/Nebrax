<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionApproval;
use App\Models\AiActionEvent;
use App\Models\AiActionPreview;
use App\Models\User;
use App\Support\AiActionCanonicalJson;
use App\Support\AiActionException;
use App\Support\Rbac;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * AI-ACTIONS-04: generates the final preview of a product import and records an
 * explicit approval of exactly that preview. Nothing here creates or updates a
 * product, posts a journal entry or moves stock; there is no executor yet, so an
 * approval is an inert, expiring authority record.
 */
final class AiActionProductApprovalService
{
    private const OPERATIONS = ['create', 'update', 'skip', 'blocked'];

    public function __construct(
        private readonly AiActionGateway $gateway,
        private readonly AiActionProductReviewService $review,
        private readonly AiActionProductPreviewBuilder $builder,
        private readonly AiActionProductImageStager $images,
        private readonly AiActionApprovalLedger $ledger,
        private readonly TenantContext $tenantContext,
        private readonly BranchContext $branchContext,
    ) {}

    /** @return array{preview:AiActionPreview,replayed:bool} */
    public function createPreview(User $requestActor, AiAction $action, int $expectedVersion): array
    {
        $actor = $this->gateway->authorizeFor($requestActor, $action, AiActionPolicy::USE);
        $this->assertProductImport($action);
        // Network and storage work happens before — never inside — the transaction that locks the action.
        $failures = $this->stageRemoteImages($actor, $action, $expectedVersion);

        return DB::transaction(function () use ($action, $expectedVersion, $actor, $failures): array {
            $locked = AiAction::query()->whereKey($action->id)->lockForUpdate()->firstOrFail();
            if (! in_array($locked->status, AiAction::MUTABLE_STATUSES, true)) {
                throw new AiActionException('state_conflict', 'لا تقبل العملية معاينة في حالتها الحالية.', 409);
            }
            if ($locked->version !== $expectedVersion) {
                throw new AiActionException('version_conflict', 'تغيّرت المسودة. حدّث البيانات قبل إنشاء معاينة.', 409);
            }

            [$preview, $hash, $proposalHash, $manifestHash] = $this->compute($locked, $failures);
            $existing = AiActionPreview::query()->where('ai_action_id', $locked->id)->where('action_version', $locked->version)
                ->where('preview_hash', $hash)->whereNull('invalidated_at')->where('expires_at', '>', now('UTC'))->first();
            if ($existing !== null) {
                return ['preview' => $existing, 'replayed' => true];
            }

            $approvable = $preview['totals']['errors'] === 0;
            $model = AiActionPreview::create([
                'ai_action_id' => $locked->id, 'action_version' => $locked->version, 'branch_id' => $this->branchContext->id(),
                'preview_hash' => $hash, 'proposal_hash' => $proposalHash, 'manifest_hash' => $manifestHash,
                'preview' => $preview, 'summary' => ['totals' => $preview['totals'], 'issues' => $preview['issues']],
                'approvable' => $approvable, 'generated_by' => $actor->id,
                'expires_at' => now('UTC')->addMinutes(max(1, (int) config('ai_actions.preview_ttl_minutes', 30))),
            ]);
            // A fresh preview supersedes the older ones and any approval that rested on them.
            $this->ledger->invalidate($locked, $actor, 'preview_superseded', $model->id);

            $from = $locked->status;
            $to = $approvable ? AiAction::STATUS_READY_FOR_APPROVAL : (in_array($from, [AiAction::STATUS_CREATED, AiAction::STATUS_EDITING], true) ? $from : AiAction::STATUS_EDITING);
            $locked->forceFill(['status' => $to])->save();
            $this->event($locked, 'preview_generated', $from, $to, $actor, [
                'preview_id' => $model->id, 'preview_hash' => $hash, 'approvable' => $approvable,
                'create' => $preview['totals']['create'], 'update' => $preview['totals']['update'],
                'skip' => $preview['totals']['skip'], 'blocked' => $preview['totals']['blocked'], 'errors' => $preview['totals']['errors'],
            ]);

            return ['preview' => $model, 'replayed' => false];
        }, 3);
    }

    public function preview(User $requestActor, AiAction $action, ?string $previewId): AiActionPreview
    {
        $this->gateway->authorizeFor($requestActor, $action, AiActionPolicy::USE);
        $this->assertProductImport($action);
        $this->ledger->expireIfDue($action);
        $query = AiActionPreview::query()->where('ai_action_id', $action->id);
        if ($previewId === null) {
            $preview = $query->orderByDesc('created_at')->orderByDesc('id')->first();
        } else {
            $preview = Str::isUuid($previewId) ? $query->whereKey($previewId)->first() : null;
        }
        if ($preview === null) {
            throw new AiActionException('preview_not_found', 'لا توجد معاينة لهذه العملية.', 404);
        }

        return $preview->load('approval');
    }

    /** @return array{approval:AiActionApproval,replayed:bool} */
    public function approve(User $requestActor, AiAction $action, int $expectedVersion, string $previewId, string $previewHash): array
    {
        $actor = $this->gateway->authorizeFor($requestActor, $action, AiActionPolicy::APPROVE);
        $this->assertProductImport($action);
        $preview = Str::isUuid($previewId) ? AiActionPreview::query()->where('ai_action_id', $action->id)->whereKey($previewId)->first() : null;
        if ($preview === null) {
            throw new AiActionException('preview_not_found', 'المعاينة غير موجودة لهذه العملية.', 404);
        }
        if (! hash_equals($preview->preview_hash, $previewHash)) {
            throw new AiActionException('preview_hash_mismatch', 'بصمة المعاينة لا تطابق المعاينة المعروضة؛ أعد تحميلها قبل الموافقة.', 409);
        }
        // The approver must be able to see what they approve: cost values need `products.view_cost`.
        if (($preview->summary['totals']['has_cost_values'] ?? false) === true && ! Rbac::allows((string) $actor->role, 'products.view_cost')) {
            throw new AiActionException('cost_permission_required', 'تحتوي المعاينة أسعار شراء؛ تتطلب الموافقة صلاحية عرض التكلفة.', 403);
        }

        $outcome = DB::transaction(function () use ($action, $expectedVersion, $preview, $actor): array {
            $locked = AiAction::query()->whereKey($action->id)->lockForUpdate()->firstOrFail();
            $fresh = AiActionPreview::query()->whereKey($preview->id)->lockForUpdate()->firstOrFail();

            $existing = AiActionApproval::query()->where('ai_action_preview_id', $fresh->id)->first();
            if ($existing !== null) {
                if ($existing->approved_by === $actor->id && $existing->isActive() && $locked->status === AiAction::STATUS_APPROVED) {
                    return ['approval' => $existing, 'replayed' => true];
                }
                throw new AiActionException('already_decided', 'سبق البتّ في موافقة هذه المعاينة ولا يمكن إعادة استخدامها.', 409);
            }
            if (! $fresh->approvable) {
                throw new AiActionException('preview_blocked', 'تحتوي المعاينة أخطاء تمنع التنفيذ؛ صحّحها ثم أنشئ معاينة جديدة.', 422);
            }
            if ($locked->status !== AiAction::STATUS_READY_FOR_APPROVAL) {
                throw new AiActionException('state_conflict', 'العملية ليست جاهزة للموافقة؛ أنشئ معاينة جديدة.', 409);
            }
            if ($locked->version !== $expectedVersion || $fresh->action_version !== $locked->version) {
                throw new AiActionException('version_conflict', 'تغيّرت المسودة بعد هذه المعاينة؛ أنشئ معاينة جديدة.', 409);
            }
            if ($fresh->invalidated_at !== null) {
                throw new AiActionException('preview_invalidated', 'أُبطلت هذه المعاينة؛ أنشئ معاينة جديدة.', 409);
            }
            if ($fresh->expires_at->isPast()) {
                $locked->forceFill(['status' => AiAction::STATUS_EXPIRED])->save();
                $this->event($locked, 'preview_expired', AiAction::STATUS_READY_FOR_APPROVAL, AiAction::STATUS_EXPIRED, null, ['preview_id' => $fresh->id]);

                return ['rejected' => ['preview_expired', 'انتهت صلاحية المعاينة؛ أنشئ معاينة جديدة.']];
            }

            // Live re-check: the catalogue and the draft must still produce this exact preview.
            [, $hash] = $this->compute($locked);
            if (! hash_equals($fresh->preview_hash, $hash)) {
                $this->ledger->invalidate($locked, $actor, 'live_state_changed');
                $locked->forceFill(['status' => AiAction::STATUS_EDITING])->save();
                $this->event($locked, 'preview_stale', AiAction::STATUS_READY_FOR_APPROVAL, AiAction::STATUS_EDITING, $actor, ['preview_id' => $fresh->id]);

                return ['rejected' => ['preview_stale', 'تغيّرت بيانات المنتجات منذ المعاينة؛ أنشئ معاينة جديدة وراجعها.']];
            }

            $approval = AiActionApproval::create([
                'ai_action_id' => $locked->id, 'ai_action_preview_id' => $fresh->id, 'action_version' => $locked->version,
                'branch_id' => $this->branchContext->id(), 'preview_hash' => $fresh->preview_hash, 'approved_by' => $actor->id,
                'permission_digest' => $this->permissionDigest($actor), 'approved_at' => now('UTC'),
                'expires_at' => now('UTC')->addMinutes(max(1, (int) config('ai_actions.approval_ttl_minutes', 60))),
            ]);
            $locked->forceFill(['status' => AiAction::STATUS_APPROVED])->save();
            $this->event($locked, 'approval_granted', AiAction::STATUS_READY_FOR_APPROVAL, AiAction::STATUS_APPROVED, $actor, [
                'preview_id' => $fresh->id, 'preview_hash' => $fresh->preview_hash, 'approval_id' => $approval->id,
                'expires_at' => $approval->expires_at->toIso8601String(),
            ]);

            return ['approval' => $approval, 'replayed' => false];
        }, 3);

        if (isset($outcome['rejected'])) {
            throw new AiActionException($outcome['rejected'][0], $outcome['rejected'][1], 409);
        }

        return $outcome;
    }

    /**
     * @param  array{operation?:?string,page?:mixed,per_page?:mixed}  $query
     * @return array<string,mixed>
     */
    public function present(AiActionPreview $preview, User $actor, array $query = []): array
    {
        $canCost = Rbac::allows((string) $actor->role, 'products.view_cost');
        $operation = in_array($query['operation'] ?? null, self::OPERATIONS, true) ? $query['operation'] : null;
        $rows = array_values(array_filter($preview->preview['rows'] ?? [], static fn (array $row): bool => $operation === null || $row['operation'] === $operation));
        $perPage = min(500, max(1, (int) ($query['per_page'] ?? config('ai_actions.preview_page_size', 100))));
        $page = max(1, (int) ($query['page'] ?? 1));
        $slice = array_slice($rows, ($page - 1) * $perPage, $perPage);
        $hasCost = ($preview->summary['totals']['has_cost_values'] ?? false) === true;
        $approval = $preview->approval;

        return [
            'id' => $preview->id,
            'action_id' => $preview->ai_action_id,
            'action_version' => (int) $preview->action_version,
            'status' => $preview->invalidated_at !== null ? 'invalidated' : ($preview->expires_at->isPast() ? 'expired' : 'active'),
            'invalidation_reason' => $preview->invalidation_reason,
            'preview_hash' => $preview->preview_hash,
            'proposal_hash' => $preview->proposal_hash,
            'manifest_hash' => $preview->manifest_hash,
            'approvable' => (bool) $preview->approvable,
            'generated_by' => $preview->generated_by,
            'generated_at' => optional($preview->created_at)->toIso8601String(),
            'expires_at' => optional($preview->expires_at)->toIso8601String(),
            'totals' => $preview->preview['totals'] ?? [],
            'issues' => $preview->preview['issues'] ?? [],
            'images' => $preview->preview['images'] ?? null,
            'rows' => array_map(fn (array $row): array => $canCost ? $row : $this->redactCost($row), $slice),
            'pagination' => ['page' => $page, 'per_page' => $perPage, 'total' => count($rows), 'last_page' => max(1, (int) ceil(count($rows) / $perPage)), 'operation' => $operation],
            'approval' => $approval === null ? null : $this->presentApproval($approval),
            'permissions' => [
                'can_view_cost' => $canCost,
                'cost_hidden' => $hasCost && ! $canCost,
                'can_approve' => Rbac::allows((string) $actor->role, AiActionPolicy::APPROVE) && Rbac::allows((string) $actor->role, 'products.manage') && (! $hasCost || $canCost),
            ],
        ];
    }

    /** @return array<string,mixed> */
    public function presentApproval(AiActionApproval $approval): array
    {
        return [
            'id' => $approval->id,
            'preview_id' => $approval->ai_action_preview_id,
            'action_version' => (int) $approval->action_version,
            'preview_hash' => $approval->preview_hash,
            'approved_by' => $approval->approved_by,
            'approved_at' => optional($approval->approved_at)->toIso8601String(),
            'expires_at' => optional($approval->expires_at)->toIso8601String(),
            'revoked_at' => optional($approval->revoked_at)->toIso8601String(),
            'revocation_reason' => $approval->revocation_reason,
            'status' => $approval->revoked_at !== null ? 'revoked' : ($approval->expires_at->isPast() ? 'expired' : 'active'),
        ];
    }

    /**
     * Stages the remote images this version's decided rows name. A stale version stages nothing: the locked
     * check that follows raises the conflict. Returns the sources that could not be staged, keyed by source key.
     *
     * @return array<string,array{status:string,code:?string,message:?string}>
     */
    private function stageRemoteImages(User $actor, AiAction $action, int $expectedVersion): array
    {
        $current = AiAction::query()->whereKey($action->id)->first();
        if ($current === null || $current->version !== $expectedVersion || ! in_array($current->status, AiAction::MUTABLE_STATUSES, true)) {
            return [];
        }
        $urls = [];
        foreach ($this->review->effective($current)['proposal']['rows'] ?? [] as $row) {
            $urls = array_merge($urls, AiActionProductPreviewBuilder::candidateUrls($row));
        }
        if ($urls === []) {
            return [];
        }
        $failures = [];
        foreach ($this->images->stageUrls($actor, $current, $urls) as $key => $outcome) {
            if ($outcome['status'] !== 'ready') {
                $failures[$key] = ['status' => $outcome['status'], 'code' => $outcome['code'], 'message' => $outcome['message']];
            }
        }

        return $failures;
    }

    /**
     * @param  array<string,array{status:string,code:?string,message:?string}>  $failures  preview-time reasons only
     * @return array{0:array<string,mixed>,1:string,2:?string,3:?string}
     */
    public function compute(AiAction $locked, array $failures = []): array
    {
        $effective = $this->review->effective($locked);
        $rows = $effective['proposal']['rows'] ?? [];
        if ($rows === []) {
            throw new AiActionException('proposal_empty', 'لا توجد صفوف منتجات لمعاينتها.', 422);
        }
        $preview = $this->builder->build($rows, [
            'action_id' => $locked->id, 'version' => (int) $locked->version, 'branch_id' => $this->branchContext->id(),
            'proposal_hash' => $effective['proposal_hash'], 'manifest_hash' => $effective['manifest_hash'], 'file_sha256' => $effective['file_sha256'],
        ], ['catalog' => $this->images->catalog($locked), 'failures' => $failures]);
        $hash = AiActionCanonicalJson::previewHash((string) $this->tenantContext->id(), $locked->id, $locked->type, (int) $locked->version, $preview);

        return [$preview, $hash, $effective['proposal_hash'], $effective['manifest_hash']];
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function redactCost(array $row): array
    {
        $row['changes'] = array_map(static fn (array $change): array => $change['field'] === 'purchase_price'
            ? ['field' => 'purchase_price', 'before' => null, 'after' => null, 'redacted' => true] : $change, $row['changes'] ?? []);
        if (isset($row['prices']['purchase_price'])) {
            $row['prices']['purchase_price'] = ['before' => null, 'after' => null, 'redacted' => true];
        }

        return $row;
    }

    private function permissionDigest(User $actor): string
    {
        $role = (string) $actor->role;

        return AiActionCanonicalJson::digest('ai_action_approval_authority.v1', [
            'tenant_id' => (string) $this->tenantContext->id(), 'user_id' => (string) $actor->id, 'role' => $role,
            'branch_id' => $this->branchContext->id(),
            'permissions' => [
                AiActionPolicy::USE => Rbac::allows($role, AiActionPolicy::USE),
                AiActionPolicy::APPROVE => Rbac::allows($role, AiActionPolicy::APPROVE),
                'products.manage' => Rbac::allows($role, 'products.manage'),
                'products.view_cost' => Rbac::allows($role, 'products.view_cost'),
            ],
        ]);
    }

    private function assertProductImport(AiAction $action): void
    {
        if ($action->type !== AiActionRegistry::PRODUCT_IMPORT) {
            throw new AiActionException('action_type_invalid', 'المعاينة مدعومة لاستيراد المنتجات فقط.', 422);
        }
    }

    private function event(AiAction $action, string $event, ?string $from, ?string $to, ?User $actor, array $metadata = []): void
    {
        AiActionEvent::create([
            'ai_action_id' => $action->id, 'version' => $action->version, 'event' => $event,
            'from_status' => $from, 'to_status' => $to, 'actor_id' => $actor?->id,
            'metadata' => $metadata === [] ? null : $metadata, 'occurred_at' => now('UTC'),
        ]);
    }
}
