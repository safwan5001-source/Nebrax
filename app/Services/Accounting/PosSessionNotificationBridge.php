<?php

namespace App\Services\Accounting;

use App\Models\PosSession;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Observer-only projection for actionable POS session states. */
class PosSessionNotificationBridge
{
    public function queueEvaluation(string $tenantId, string $sessionId): void
    {
        DB::afterCommit(function () use ($tenantId, $sessionId): void {
            try {
                $this->evaluate($tenantId, $sessionId);
            } catch (\Throwable $e) {
                Log::warning('POS session notification projection failed', [
                    'tenant_id' => $tenantId,
                    'session_id' => $sessionId,
                    'exception' => $e::class,
                ]);
            }
        });
    }

    public function evaluate(string $tenantId, string $sessionId): void
    {
        $session = PosSession::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($sessionId)
            ->first();
        if (! $session || $session->status !== 'closed') {
            return;
        }

        if ($session->difference_status === 'pending') {
            $this->deliver($tenantId, $session, 'pos.variance_pending', 'critical',
                'فرق صندوق يحتاج اعتماداً', 'أُغلقت جلسة نقطة بيع وبها فرق صندوق يحتاج مراجعة واعتماداً.',
                'pos.variance.approve', 'view_pos_session', 'variance');
        }

        if ($session->handover_status === 'pending') {
            $this->deliver($tenantId, $session, 'pos.handover_pending', 'warning',
                'عهدة نقطة بيع بانتظار الاستلام', 'أُغلقت جلسة نقطة بيع وقدمت عهدتها وهي بانتظار الاستلام.',
                'pos.session.handover.confirm', 'view_pos_session', 'handover');
        }
    }

    private function deliver(string $tenantId, PosSession $session, string $type, string $severity, string $title, string $message, string $permission, string $action, string $kind): void
    {
        $notifications = app(NotificationService::class);
        foreach ($this->recipients($tenantId, $session, $permission) as $recipient) {
            $notifications->deliver([
                'tenant_id' => $tenantId,
                'recipient_id' => $recipient->id,
                'category' => 'alert',
                'type' => $type,
                'severity' => $severity,
                'title' => $title,
                'message' => $message,
                'source_type' => 'pos_session',
                'source_id' => $session->id,
                'action' => $action,
                'data' => ['session_number' => $session->number],
                'dedupe_key' => "pos.{$kind}:{$session->id}",
            ]);
        }
    }

    /** @return Collection<int, User> */
    private function recipients(string $tenantId, PosSession $session, string $permission): Collection
    {
        return User::query()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->get()
            ->filter(fn (User $user): bool => $user->hasPermission($permission)
                && ($session->branch_id === null || $user->canAccessBranch($session->branch_id)))
            ->values();
    }
}
