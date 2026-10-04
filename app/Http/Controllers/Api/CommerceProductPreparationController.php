<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceProductPreparation;
use App\Models\Product;
use App\Services\Commerce\ProductPreparationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FLOWERS-H8 / ADR-20 — مهلة تجهيز منتج: قراءة (`products.view`) وضبط (`products.manage`). `{id}` محدِّد منتج
 * فقط والملكية عبر `TenantScope` (404 غير كاشف).
 */
final class CommerceProductPreparationController extends ApiController
{
    public function show(Request $request, ProductPreparationService $preparation, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $product = Product::query()->findOrFail($id);

        return response()->json(['data' => ['preparation_minutes' => $preparation->minutes($product)]]);
    }

    public function replace(Request $request, ProductPreparationService $preparation, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            // عدد صحيح JSON فعلي: `integer` وحدها تقبل `true` (≡ 1) وسلاسل رقمية.
            'preparation_minutes' => ['present', 'nullable', 'integer', 'min:0', 'max:'.CommerceProductPreparation::MAX_MINUTES,
                fn (string $attribute, mixed $value, \Closure $fail) => $value === null || is_int($value) ? null : $fail('مهلة التجهيز عددٌ صحيح بالدقائق.')],
        ]);
        $product = Product::query()->findOrFail($id);

        return response()->json(['data' => ['preparation_minutes' => $preparation->set($product, $data['preparation_minutes'])]]);
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'إدارة مهلة تجهيز المنتج غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
