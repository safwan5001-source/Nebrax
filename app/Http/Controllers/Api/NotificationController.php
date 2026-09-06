<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\NotificationResource;
use App\Models\Notification;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * صندوق إشعارات المستخدم الحالي فقط. **كل** استعلام هنا مُقيَّد صراحةً
 * بـ `recipient_id = المستخدم المصادَق` — معرّف الإشعار وحده لا يكفي أبداً
 * (العزل بالمستأجر يأتي تلقائياً من `TenantScope`، لكن هذا لا يميّز بين
 * مستخدمين في نفس المستأجر). لا مسار هنا يُنشئ إشعاراً — المُنتِجون
 * الخادميون وحدهم عبر `NotificationService::deliver()`.
 */
class NotificationController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'category' => ['sometimes', 'nullable', 'in:alert,update'],
            'read' => ['sometimes', 'nullable', 'in:read,unread'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = $this->ownNotifications($request)
            ->when(
                $filters['category'] ?? null,
                fn (Builder $q, string $category) => $q->where('category', $category)
            )
            ->when(
                $filters['read'] ?? null,
                fn (Builder $q, string $read) => $read === 'read' ? $q->whereNotNull('read_at') : $q->whereNull('read_at')
            )
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        $perPage = (int) ($filters['per_page'] ?? 20);

        return NotificationResource::collection($query->paginate($perPage)->withQueryString())->response();
    }

    public function unreadCount(Request $request): JsonResponse
    {
        $count = $this->ownNotifications($request)->whereNull('read_at')->count();

        return response()->json(['data' => ['count' => $count]]);
    }

    public function markRead(Request $request, string $id): JsonResponse
    {
        $notification = $this->ownNotifications($request)->whereKey($id)->firstOrFail();

        if ($notification->read_at === null) {
            $notification->update(['read_at' => now()]);
        }

        return response()->json(['data' => new NotificationResource($notification)]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $updated = $this->ownNotifications($request)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return response()->json(['data' => ['updated' => $updated]]);
    }

    private function ownNotifications(Request $request): Builder
    {
        return Notification::query()->where('recipient_id', $request->user()->id);
    }
}
