<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Services\Commerce\CommerceProductPublicationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** COM-WS-3 — tenant-scoped ERP control for publishing an AWJ product to web stores. */
final class CommerceProductPublicationController extends ApiController
{
    /**
     * COM-CATALOG-1 — Product Publication Workspace list.
     *
     * Read-only list over the same source of truth as show/update
     * (CommerceListing.is_published). Tenant isolation stays in the service:
     * products resolve through the tenant-scoped Product query and storefronts
     * through the tenant-authorized web set — a cross-tenant storefront_id is
     * rejected without revealing anything about the other tenant.
     */
    public function index(Request $request, CommerceProductPublicationService $publication): JsonResponse
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

    public function show(Request $request, string $id, CommerceProductPublicationService $publication): JsonResponse
    {
        $this->denySelfService($request);
        $product = Product::query()->findOrFail($id);

        return response()->json(['data' => ['stores' => $publication->state($product)]]);
    }

    public function update(Request $request, string $id, CommerceProductPublicationService $publication): JsonResponse
    {
        $this->denySelfService($request);
        $validated = $request->validate([
            'storefront_ids' => ['present', 'array'],
            'storefront_ids.*' => ['string', 'uuid', 'distinct'],
        ]);
        $product = Product::query()->findOrFail($id);

        return response()->json([
            'data' => [
                'stores' => $publication->replace($product, array_values($validated['storefront_ids'])),
            ],
        ]);
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'إدارة نشر المنتجات غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
