<?php

namespace App\Services;

use App\Models\SystemUpdate;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * ═══════════════════════════════════════════════════════════════
 *  خدمة نشر تحديثات النظام (PR-NOTIF-6) — idempotent
 * ═══════════════════════════════════════════════════════════════
 *  تنقل التحديث من `draft` إلى `published`، ثم تسلّم إشعاراً
 *  عبر `NotificationService::deliver()` لكل مستهدف. إعادة
 *  الاستدعاء على تحديث منشور لا تولّد إشعارات مكررة (dedupe_key
 *  ثابت لكل تحديث+مستلم).
 *
 *  **لا تعدّل أي جدول محاسبي ولا مخزني ولا ZATCA.**
 */
class SystemUpdatePublicationService
{
    public function __construct(
        private readonly NotificationService $notifications,
    ) {}

    /**
     * ينشر التحديث ويسلّم الإشعارات. Idempotent: يعيد التحديث
     * المنشور كما هو بلا إشعارات مكررة عند إعادة الاستدعاء.
     */
    public function publish(SystemUpdate $update): SystemUpdate
    {
        if ($update->isPublished()) {
            return $update;
        }

        if (! $update->isDraft()) {
            throw new RuntimeException('لا يمكن نشر تحديث ليس في حالة مسودة.');
        }

        DB::transaction(function () use ($update) {
            $update->update([
                'status' => SystemUpdate::STATUS_PUBLISHED,
                'published_at' => now(),
            ]);
        });

        $this->deliverNotifications($update);

        return $update->fresh();
    }

    private function deliverNotifications(SystemUpdate $update): void
    {
        $recipients = $this->resolveRecipients($update);
        $ctx = app(TenantContext::class);
        $originalTenantId = $ctx->has() ? $ctx->id() : null;

        try {
            foreach ($recipients as $recipient) {
                try {
                    $ctx->set($recipient->tenant_id);

                    $this->notifications->deliver([
                        'tenant_id' => $recipient->tenant_id,
                        'recipient_id' => $recipient->id,
                        'category' => 'update',
                        'type' => 'system.update_published',
                        'severity' => 'info',
                        'title' => $update->title_ar,
                        'message' => Str::limit($update->content_ar, 200),
                        'source_type' => 'system_update',
                        'source_id' => $update->id,
                        'action' => 'view_system_update',
                        'data' => null,
                        'dedupe_key' => "system.update_published:{$update->id}",
                    ]);
                } catch (Throwable $e) {
                    Log::error('system_update_notification_failed', [
                        'update_id' => $update->id,
                        'recipient_id' => $recipient->id,
                        'message' => $e->getMessage(),
                    ]);
                }
            }
        } finally {
            if ($originalTenantId !== null) {
                $ctx->set($originalTenantId);
            } else {
                $ctx->forget();
            }
        }
    }

    /**
     * @return Collection<int, User>
     */
    private function resolveRecipients(SystemUpdate $update): Collection
    {
        return match ($update->target_type) {
            SystemUpdate::TARGET_ALL => $this->allActiveUsers(),
            SystemUpdate::TARGET_TENANTS => $this->usersInTargetTenants($update),
            SystemUpdate::TARGET_USERS => $this->targetUsers($update),
            default => collect(),
        };
    }

    private function allActiveUsers(): Collection
    {
        return User::query()
            ->where('is_active', true)
            ->whereHas('tenant')
            ->get();
    }

    private function usersInTargetTenants(SystemUpdate $update): Collection
    {
        $tenantIds = $update->targets()
            ->where('target_type', 'tenant')
            ->pluck('target_id');

        return User::query()
            ->whereIn('tenant_id', $tenantIds)
            ->where('is_active', true)
            ->get();
    }

    private function targetUsers(SystemUpdate $update): Collection
    {
        $userIds = $update->targets()
            ->where('target_type', 'user')
            ->pluck('target_id');

        return User::query()
            ->whereIn('id', $userIds)
            ->where('is_active', true)
            ->get();
    }
}
