<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\DeveloperWebhookDeliveryResource;
use App\Models\WebhookDelivery;
use App\Support\WebhookEventCatalog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * قراءة سجلّ تسليم الـ Webhooks لمستأجر أَوْج عبر الجلسة الداخلية (PR-7.5) — **للقراءة
 * فقط**، بلا إعادة تشغيل أو تعديل. معزول بالمستأجر، بترقيم مُقيَّد بسقف صلب، وبيانات
 * آمنة فقط عبر `DeveloperWebhookDeliveryResource`. مرشّحات اختيارية بسيطة يدعمها المخطّط.
 */
class DeveloperWebhookDeliveryController extends Controller
{
    private const DEFAULT_PER_PAGE = 25;
    private const MAX_PER_PAGE = 100;

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'webhook_endpoint_id' => ['sometimes', 'nullable', 'uuid'],
            'event_type'          => ['sometimes', 'nullable', Rule::in(WebhookEventCatalog::all())],
            'status'              => ['sometimes', 'nullable', Rule::in([
                WebhookDelivery::STATUS_PENDING,
                WebhookDelivery::STATUS_PROCESSING,
                WebhookDelivery::STATUS_DELIVERED,
                WebhookDelivery::STATUS_RETRY_SCHEDULED,
                WebhookDelivery::STATUS_FAILED,
            ])],
            'date_from'           => ['sometimes', 'nullable', 'date'],
            'date_to'             => ['sometimes', 'nullable', 'date', 'after_or_equal:date_from'],
            'per_page'            => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        // معزول بالمستأجر (BaseModel + SetTenant). العلاقات مُحمَّلة بأعمدة آمنة فقط.
        $query = WebhookDelivery::query()
            ->with(['event:id,type', 'endpoint:id,url'])
            ->orderByDesc('created_at');

        if (filled($filters['webhook_endpoint_id'] ?? null)) {
            $query->where('webhook_endpoint_id', $filters['webhook_endpoint_id']);
        }
        if (filled($filters['status'] ?? null)) {
            $query->where('status', $filters['status']);
        }
        if (filled($filters['event_type'] ?? null)) {
            $query->whereHas('event', fn ($e) => $e->where('type', $filters['event_type']));
        }
        if (filled($filters['date_from'] ?? null)) {
            $query->whereDate('created_at', '>=', $filters['date_from']);
        }
        if (filled($filters['date_to'] ?? null)) {
            $query->whereDate('created_at', '<=', $filters['date_to']);
        }

        $perPage = min(self::MAX_PER_PAGE, max(1, (int) ($filters['per_page'] ?? self::DEFAULT_PER_PAGE)));

        return DeveloperWebhookDeliveryResource::collection($query->paginate($perPage))->response();
    }
}
