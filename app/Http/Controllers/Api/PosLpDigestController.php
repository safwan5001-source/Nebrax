<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PosLpDigestResource;
use App\Models\PosLpDigest;
use App\Models\Tenant;
use App\Services\Pos\PosLpDigestService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * الملخص الرقابي اليومي (Daily LP Digest) — قراءة قائمة/تفصيل + توليد يدوي. صفّ واحد
 * لكل (مستأجر، تاريخ)، فلا فلترة فرع خادمية على مستوى الصف — الفرع تفصيل داخل
 * `branch_breakdown`/`payload` تُصفّيه الواجهة محلياً بلا إعادة توليد.
 */
class PosLpDigestController extends ApiController
{
    public function __construct(private readonly PosLpDigestService $service) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'], 'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = PosLpDigest::query();
        if (! empty($filters['from'])) $query->where('digest_date', '>=', $filters['from']);
        if (! empty($filters['to'])) $query->where('digest_date', '<=', $filters['to']);

        $total = (clone $query)->count();
        $perPage = min(max((int) ($filters['per_page'] ?? 30), 1), 100);
        $page = max((int) ($filters['page'] ?? 1), 1);
        $rows = $query->orderByDesc('digest_date')->forPage($page, $perPage)->get();

        return response()->json([
            'data' => PosLpDigestResource::collection($rows),
            'meta' => ['total' => $total, 'per_page' => $perPage, 'current_page' => $page, 'last_page' => max(1, (int) ceil($total / $perPage))],
        ]);
    }

    public function show(Request $request, string $date): JsonResponse
    {
        $digest = PosLpDigest::query()->where('digest_date', $date)->firstOrFail();

        return response()->json(['data' => new PosLpDigestResource($digest)]);
    }

    public function latest(Request $request): JsonResponse
    {
        $digest = PosLpDigest::query()->orderByDesc('digest_date')->first();

        return response()->json(['data' => $digest ? new PosLpDigestResource($digest) : null]);
    }

    /** توليد/إعادة توليد يدوي — idempotent لنفس اليوم، يتطلب pos.investigations.manage. */
    public function generate(Request $request): JsonResponse
    {
        $data = $request->validate(['date' => ['nullable', 'date']]);
        $tenant = Tenant::findOrFail(app(\App\Tenancy\TenantContext::class)->id());
        $forDate = ! empty($data['date']) ? Carbon::parse($data['date']) : null;

        $digest = $this->service->generate($tenant, $forDate, $request->user()->id);

        return response()->json(['data' => new PosLpDigestResource($digest)], 201);
    }
}
