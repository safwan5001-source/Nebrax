<?php

namespace App\Http\Controllers\Api;

use App\Models\ProductCategory;
use App\Services\Commerce\CommerceCategoryPublicationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** COM-CATALOG-2 — tenant-scoped ERP control for publishing an AWJ category to web stores. */
final class CommerceCategoryPublicationController extends ApiController
{
    /**
     * Category Publication Workspace list — read-only list over the same
     * source of truth as show/update (CommerceCategoryListing.is_published).
     * Tenant isolation stays in the service: categories resolve through the
     * tenant-scoped ProductCategory query and storefronts through the
     * tenant-authorized web set — a cross-tenant storefront_id is rejected
     * without revealing anything about the other tenant.
     */
    public function index(Request $request, CommerceCategoryPublicationService $publication): JsonResponse
    {
        $this->denySelfService($request);
        $validated = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'status' => ['sometimes', 'nullable', 'in:all,published,unpublished'],
            'storefront_id' => ['sometimes', 'nullable', 'string', 'uuid'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
        ]);

        $paginator = $publication->list($validated);

        return response()->json([
            'data' => $paginator->items(),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    public function show(Request $request, string $id, CommerceCategoryPublicationService $publication): JsonResponse
    {
        $this->denySelfService($request);
        $category = ProductCategory::query()->findOrFail($id);

        return response()->json(['data' => ['stores' => $publication->state($category)]]);
    }

    public function update(Request $request, string $id, CommerceCategoryPublicationService $publication): JsonResponse
    {
        $this->denySelfService($request);
        $validated = $request->validate([
            'storefront_ids' => ['present', 'array'],
            'storefront_ids.*' => ['string', 'uuid', 'distinct'],
        ]);
        $category = ProductCategory::query()->findOrFail($id);

        return response()->json([
            'data' => [
                'stores' => $publication->replace($category, array_values($validated['storefront_ids'])),
            ],
        ]);
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'إدارة نشر التصنيفات غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
