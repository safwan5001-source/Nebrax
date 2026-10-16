<?php

namespace App\Http\Controllers\Api;

use App\Models\AiAuditEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * قراءة سجل تدقيق المساعد الذكي (AI-02A) — للمستأجر نفسه فقط (عزل تلقائي بـTenantScope)، بصلاحية
 * مستقلة `ai.audit.view` على المسار. الحقول المعروضة قائمة بيضاء وصفية؛ لا يوجد في الجدول أصلاً
 * نصّ رسالة أو ردّ أو مفتاح. القراءة فقط — لا تعديل ولا حذف عبر الـAPI.
 */
class AiAuditController extends ApiController
{
    private const COLUMNS = [
        'id', 'request_id', 'actor_id', 'feature', 'event', 'tool', 'provider', 'model', 'outcome', 'reason',
        'attempt', 'input_tokens', 'output_tokens', 'cost_micro_usd', 'meta', 'occurred_at',
    ];

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'request_id' => ['sometimes', 'uuid'],
            'event' => ['sometimes', 'string', 'regex:/^[a-z][a-z0-9_.]{0,39}$/'],
            'outcome' => ['sometimes', 'in:allowed,denied,error'],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $page = AiAuditEvent::query()
            ->select(self::COLUMNS)
            ->when($data['request_id'] ?? null, fn ($q, $v) => $q->where('request_id', $v))
            ->when($data['event'] ?? null, fn ($q, $v) => $q->where('event', $v))
            ->when($data['outcome'] ?? null, fn ($q, $v) => $q->where('outcome', $v))
            ->when($data['from'] ?? null, fn ($q, $v) => $q->where('occurred_at', '>=', $v))
            ->when($data['to'] ?? null, fn ($q, $v) => $q->where('occurred_at', '<=', $v . ' 23:59:59'))
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->paginate((int) ($data['per_page'] ?? 25));

        return response()->json([
            'data' => $page->items(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }
}
