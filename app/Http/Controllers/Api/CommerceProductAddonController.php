<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceProductAddon;
use App\Models\Product;
use App\Services\Commerce\ProductAddonService;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FLOWERS-H6 / ADR-18 — إضافات المنتج: قراءة (`products.view`) واستبدال ذرّي لمجموعة العلاقات
 * (`products.manage`). `{id}` محدِّد منتج فقط والملكية عبر `TenantScope` (404 غير كاشف). الإضافة
 * منتجٌ حقيقي يُباع بسعره ومخزونه الأصليين؛ لا سعر ولا مخزون هنا.
 */
final class CommerceProductAddonController extends ApiController
{
    public function show(Request $request, ProductAddonService $addons, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $product = Product::query()->findOrFail($id);

        return response()->json(['data' => ['addons' => $addons->definitions($product)]]);
    }

    public function replace(Request $request, ProductAddonService $addons, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'addons' => ['present', 'array', 'max:'.ProductAddonService::MAX_ADDONS],
            'addons.*.addon_product_id' => ['required', 'uuid'],
            'addons.*.addon_variant_id' => ['sometimes', 'nullable', 'uuid'],
            'addons.*.max_quantity' => ['sometimes', 'integer', 'min:1', 'max:'.CommerceProductAddon::MAX_QUANTITY_CEILING],
            'addons.*.is_active' => ['sometimes', 'boolean'],
        ]);
        $product = Product::query()->findOrFail($id);

        try {
            $definitions = $addons->replace($product, array_values($data['addons']));
        } catch (DomainException $e) {
            abort(422, $e->getMessage());
        }

        return response()->json(['data' => ['addons' => $definitions]]);
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'إدارة الإضافات غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
