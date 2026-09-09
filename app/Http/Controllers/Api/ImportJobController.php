<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreImportJobRequest;
use App\Http\Resources\ImportJobResource;
use App\Models\ImportJob;
use App\Services\ImportJobService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PR-DUR-1 — بنية تشغيلة الاستيراد الدائم فقط: رفع/فحص هيكلي/عرض/إلغاء.
 * لا علاقة له بأي مسار استيراد حالي (`/products/import/*`، `/products/workbook/*`،
 * `/inventory-openings/import/*`) — مسارٌ إضافي مستقل تماماً، صفر تأثير عليها.
 */
class ImportJobController extends ApiController
{
    public function __construct(private readonly ImportJobService $jobs) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'domain' => ['sometimes', 'nullable', 'string'],
            'status' => ['sometimes', 'nullable', 'string'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
        ]);

        $query = ImportJob::query()->orderByDesc('created_at');
        if (! empty($filters['domain'])) {
            $query->where('domain', $filters['domain']);
        }
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return ImportJobResource::collection(
            $query->paginate((int) ($filters['per_page'] ?? 20))->withQueryString()
        )->response();
    }

    public function show(string $id): JsonResponse
    {
        return (new ImportJobResource(ImportJob::query()->whereKey($id)->firstOrFail()))->response();
    }

    public function store(StoreImportJobRequest $request): JsonResponse
    {
        $job = $this->domain(fn () => $this->jobs->create(
            $request->file('file'),
            (string) $request->input('domain'),
            $request->input('idempotency_key'),
            $request->user()?->id,
        ));

        return (new ImportJobResource($job))->response()->setStatusCode(201);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $job = ImportJob::query()->whereKey($id)->firstOrFail();
        $job = $this->domain(fn () => $this->jobs->cancel($job, $request->user()?->id));

        return (new ImportJobResource($job))->response();
    }
}
