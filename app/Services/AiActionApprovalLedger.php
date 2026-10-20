<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionApproval;
use App\Models\AiActionEvent;
use App\Models\AiActionPreview;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * AI-ACTIONS-04: the single place that withdraws previews and approvals.
 * Callers hold the action row lock, so invalidation and the state change that
 * caused it commit (or roll back) together.
 */
final class AiActionApprovalLedger
{
    /** @return array{previews:int,approvals:int} */
    public function invalidate(AiAction $locked, ?User $actor, string $reason, ?string $exceptPreviewId = null): array
    {
        $now = now('UTC');
        $previews = AiActionPreview::query()->where('ai_action_id', $locked->id)->whereNull('invalidated_at')
            ->when($exceptPreviewId, fn ($query) => $query->where('id', '!=', $exceptPreviewId))
            ->update(['invalidated_at' => $now, 'invalidation_reason' => $reason, 'updated_at' => $now]);
        $approvals = AiActionApproval::query()->where('ai_action_id', $locked->id)->whereNull('revoked_at')
            ->when($exceptPreviewId, fn ($query) => $query->where('ai_action_preview_id', '!=', $exceptPreviewId))
            ->update(['revoked_at' => $now, 'revocation_reason' => $reason, 'updated_at' => $now]);

        if ($approvals > 0) {
            $this->event($locked, 'approval_revoked', $actor, ['reason' => $reason, 'approvals' => $approvals]);
        }
        if ($previews > 0) {
            $this->event($locked, 'preview_invalidated', $actor, ['reason' => $reason, 'previews' => $previews]);
        }

        return ['previews' => $previews, 'approvals' => $approvals];
    }

    /** Moves a ready/approved action to `expired` once its authority ran out. Cheap no-op otherwise. */
    public function expireIfDue(AiAction $action): AiAction
    {
        if (! in_array($action->status, [AiAction::STATUS_READY_FOR_APPROVAL, AiAction::STATUS_APPROVED], true) || ! $this->isDue($action)) {
            return $action;
        }

        return DB::transaction(function () use ($action): AiAction {
            $locked = AiAction::query()->whereKey($action->id)->lockForUpdate()->firstOrFail();
            if (! in_array($locked->status, [AiAction::STATUS_READY_FOR_APPROVAL, AiAction::STATUS_APPROVED], true) || ! $this->isDue($locked)) {
                return $locked;
            }
            $from = $locked->status;
            $locked->forceFill(['status' => AiAction::STATUS_EXPIRED])->save();
            $this->event($locked, $from === AiAction::STATUS_APPROVED ? 'approval_expired' : 'preview_expired', null, ['from_status' => $from]);

            return $locked;
        }, 3);
    }

    private function isDue(AiAction $action): bool
    {
        if ($action->status === AiAction::STATUS_APPROVED) {
            return ! AiActionApproval::query()->where('ai_action_id', $action->id)->where('action_version', $action->version)
                ->whereNull('revoked_at')->where('expires_at', '>', now('UTC'))->exists();
        }

        return ! AiActionPreview::query()->where('ai_action_id', $action->id)->where('action_version', $action->version)
            ->whereNull('invalidated_at')->where('approvable', true)->where('expires_at', '>', now('UTC'))->exists();
    }

    private function event(AiAction $action, string $event, ?User $actor, array $metadata): void
    {
        AiActionEvent::create([
            'ai_action_id' => $action->id, 'version' => $action->version, 'event' => $event,
            'from_status' => $action->status, 'to_status' => $action->status, 'actor_id' => $actor?->id,
            'metadata' => $metadata, 'occurred_at' => now('UTC'),
        ]);
    }
}
