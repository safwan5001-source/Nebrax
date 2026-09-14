<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Services\Commerce\CommerceProductPublicationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** COM-WS-3 — tenant-scoped ERP control for publishing an AWJ product to web stores. */
final class CommerceProductPublicationController extends ApiController
{
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
