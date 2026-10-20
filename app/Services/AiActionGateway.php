<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionEvent;
use App\Models\AiActionVersion;
use App\Models\User;
use App\Support\AiActionCanonicalJson;
use App\Support\AiActionException;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

final class AiActionGateway
{
    public function __construct(
        private readonly AiActionRegistry $registry,
        private readonly AiActionPolicy $policy,
        private readonly TenantContext $tenantContext,
        private readonly BranchContext $branchContext,
        private readonly AiActionApprovalLedger $ledger,
    ) {}

    public function create(User $requestActor, string $type, array $proposal): AiAction
    {
        $definition = $this->registry->definition($type);
        $actor = $this->policy->authorize((string) $requestActor->id, AiActionPolicy::USE, $definition['domain_permission']);
        $summary = $this->registry->validateProposal($type, $proposal);

        return DB::transaction(function () use ($actor, $definition, $proposal, $summary): AiAction {
            $action = AiAction::create([
                'branch_id' => $this->branchContext->id(),
                'type' => $definition['type'],
                'schema_version' => $definition['schema_version'],
                'status' => AiAction::STATUS_CREATED,
                'version' => 1,
                'created_by' => $actor->id,
                'expires_at' => now('UTC')->addDays(max(1, (int) config('ai_actions.draft_retention_days', 30))),
            ]);
            $this->storeVersion($action, $proposal, $summary, $actor, 1);
            $this->event($action, 'action_created', null, AiAction::STATUS_CREATED, $actor, ['row_count' => $summary['row_count']]);

            return $action->load('versions');
        }, 3);
    }

    public function show(User $requestActor, AiAction $action): AiAction
    {
        $definition = $this->registry->definition($action->type);
        $this->policy->authorize((string) $requestActor->id, AiActionPolicy::USE, $definition['domain_permission']);
        $this->assertBranchContext($action);
        $action = $this->ledger->expireIfDue($action);

        return $action->load(['versions' => fn ($query) => $query->orderByDesc('version')->limit(1)]);
    }

    /** Authorizes a non-mutating extraction intake against the action's own scope. */
    public function authorizeFileIntake(User $requestActor, AiAction $action): User
    {
        $definition = $this->registry->definition($action->type);
        $actor = $this->policy->authorize((string) $requestActor->id, AiActionPolicy::USE, $definition['domain_permission']);
        $this->assertBranchContext($action);

        return $actor;
    }

    /**
     * Fresh authorization for one action permission (use / approve) plus the
     * underlying domain permission, tenant, actor state and branch scope.
     */
    public function authorizeFor(User $requestActor, AiAction $action, string $actionPermission): User
    {
        $definition = $this->registry->definition($action->type);
        $actor = $this->policy->authorize((string) $requestActor->id, $actionPermission, $definition['domain_permission']);
        $this->assertBranchContext($action);

        return $actor;
    }

    public function addVersion(User $requestActor, AiAction $action, int $expectedVersion, array $proposal): AiAction
    {
        $definition = $this->registry->definition($action->type);
        $actor = $this->policy->authorize((string) $requestActor->id, AiActionPolicy::USE, $definition['domain_permission']);
        $this->assertBranchContext($action);
        $summary = $this->registry->validateProposal($action->type, $proposal);

        return DB::transaction(function () use ($action, $expectedVersion, $proposal, $summary, $actor): AiAction {
            $locked = AiAction::query()->whereKey($action->id)->lockForUpdate()->firstOrFail();
            if (! in_array($locked->status, AiAction::MUTABLE_STATUSES, true)) {
                throw new AiActionException('state_conflict', 'لا تقبل العملية تعديلات في حالتها الحالية.', 409);
            }
            if ($locked->version !== $expectedVersion) {
                throw new AiActionException('version_conflict', 'تغيّرت المسودة. حدّث البيانات قبل إعادة التعديل.', 409);
            }

            $next = $expectedVersion + 1;
            $updated = AiAction::query()->whereKey($locked->id)->where('version', $expectedVersion)->update([
                'status' => AiAction::STATUS_EDITING,
                'version' => $next,
                'updated_at' => now('UTC'),
            ]);
            if ($updated !== 1) {
                throw new AiActionException('version_conflict', 'تغيّرت المسودة بالتزامن مع هذا الطلب.', 409);
            }
            $locked->status = AiAction::STATUS_EDITING;
            $locked->version = $next;
            $this->storeVersion($locked, $proposal, $summary, $actor, $next);
            $this->event($locked, 'version_created', $action->status, AiAction::STATUS_EDITING, $actor, ['row_count' => $summary['row_count']]);
            // Any new version voids every preview and approval of the older ones.
            $this->ledger->invalidate($locked, $actor, 'proposal_edited');

            return $locked->fresh()->load(['versions' => fn ($query) => $query->orderByDesc('version')->limit(1)]);
        }, 3);
    }

    public function cancel(User $requestActor, AiAction $action, int $expectedVersion): AiAction
    {
        $definition = $this->registry->definition($action->type);
        $actor = $this->policy->authorize((string) $requestActor->id, AiActionPolicy::USE, $definition['domain_permission']);
        $this->assertBranchContext($action);

        return DB::transaction(function () use ($action, $expectedVersion, $actor): AiAction {
            $locked = AiAction::query()->whereKey($action->id)->lockForUpdate()->firstOrFail();
            if ($locked->version !== $expectedVersion) {
                throw new AiActionException('version_conflict', 'تغيّرت المسودة قبل الإلغاء.', 409);
            }
            if ($locked->status === AiAction::STATUS_CANCELLED) {
                return $locked;
            }
            if (! in_array($locked->status, AiAction::MUTABLE_STATUSES, true)) {
                throw new AiActionException('state_conflict', 'لا يمكن إلغاء العملية في حالتها الحالية.', 409);
            }

            $from = $locked->status;
            $locked->forceFill([
                'status' => AiAction::STATUS_CANCELLED,
                'cancelled_by' => $actor->id,
                'cancelled_at' => now('UTC'),
            ])->save();
            $this->event($locked, 'action_cancelled', $from, AiAction::STATUS_CANCELLED, $actor);
            $this->ledger->invalidate($locked, $actor, 'action_cancelled');

            return $locked->fresh();
        }, 3);
    }

    private function storeVersion(AiAction $action, array $proposal, array $summary, User $actor, int $version): void
    {
        AiActionVersion::create([
            'ai_action_id' => $action->id,
            'version' => $version,
            'proposal' => $proposal,
            'proposal_hash' => AiActionCanonicalJson::hash((string) $this->tenantContext->id(), $action->id, $version, $proposal),
            'validation_summary' => $summary,
            'created_by' => $actor->id,
        ]);
    }

    private function event(AiAction $action, string $event, ?string $from, ?string $to, User $actor, array $metadata = []): void
    {
        AiActionEvent::create([
            'ai_action_id' => $action->id,
            'version' => $action->version,
            'event' => $event,
            'from_status' => $from,
            'to_status' => $to,
            'actor_id' => $actor->id,
            'metadata' => $metadata === [] ? null : $metadata,
            'occurred_at' => now('UTC'),
        ]);
    }

    private function assertBranchContext(AiAction $action): void
    {
        if ($action->branch_id !== null && $action->branch_id !== $this->branchContext->id()) {
            throw new AiActionException('branch_context_conflict', 'افتح العملية من سياق الفرع الذي أُنشئت فيه.', 409);
        }
    }
}
