<?php

namespace App\Services\Accounting;

use App\Models\PosSession;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

/**
 * Read-only POS notification projection. It never changes a session, drawer,
 * reconciliation or journal; it only mirrors already-authoritative pending states.
 */
class PosSessionNotificationBridge
{
    /** @return array{scanned:int} */
    public function scanTenant(string $tenantId): array
    {
        $sessions = PosSession::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('status', 'closed')
            ->where(function ($query): void {
                $query->where('difference_status', 'pending')
                    ->orWhere('handover_status', 'pending');
            })
            ->get();

        foreach ($sessions as $session) {
            try {
                $this->evaluate($tenantId, $session);
            } catch (\Throwable $e) {
                Log::warning('POS session notification projection failed', [
                    'tenant_id' => $tenantId,
                    'session_id' => $session->id,
                    'exception' => $e::class,
                ]);
            }
        }

        return ['scanned' => $sessions->count()];
    }

    private function evaluate(string $tenantId, PosSession $session): void
    {
        if ($session->difference_status === 'pending') {
            $this->deliver($tenantId, $session, 'pos.variance_pending', 'critical',
                'فرق صندوق يحتاج اعتماداً', 'أُغلقت جلسة نقطة بيع وبها فرق صندوق يحتاج مراجعة واعتماداً.',
                'pos.variance.approve', 'variance');
        }

        if ($session->handover_status === 'pending') {
            $this->deliver($tenantId, $session, 'pos.handover_pending', 'warning',
                'عهدة نقطة بيع بانتظار الاستلام', 'أُغلقت جلسة نقطة بيع وقدمت عهدتها وهي بانتظار الاستلام.',
                'pos.session.handover.confirm', 'handover');
        }
    }

    private function deliver(string $tenantId, PosSession $session, string $type, string $severity, string $title, string $message, string $permission, string $kind): void
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
                'action' => 'view_pos_session',
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
