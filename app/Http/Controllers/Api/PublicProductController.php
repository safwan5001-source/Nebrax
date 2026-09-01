<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PublicProductResource;
use App\Models\Product;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public API — المنتجات (الكتالوج) للقراءة فقط.
 *
 * يستعلم نموذج `Product` المعزول بالمستأجر مباشرةً. لا يكشف تفاصيل مخزون/محاسبة
 * داخلية (تكلفة، حسابات، كميات، هوامش). لا كتابة.
 */
class PublicProductController extends PublicApiController
{
    private const SORTS = ['name' => 'name', 'sku' => 'sku', 'sale_price' => 'sale_price', 'created_at' => 'created_at'];

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search'    => ['sometimes', 'nullable', 'string', 'max:120'],
            'sku'       => ['sometimes', 'nullable', 'string', 'max:120'],
            'barcode'   => ['sometimes', 'nullable', 'string', 'max:120'],
            'type'      => ['sometimes', 'nullable', 'in:good,service'],
            'is_active' => ['sometimes', 'nullable', 'boolean'],
            'sort'      => ['sometimes', 'nullable', 'string', 'max:40'],
            'page'      => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page'  => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        // تحميل مسبق لاسمَي التصنيف والعلامة فقط (حقول العقد العام) — تفادي N+1.
        $query = Product::query()->with(['productCategory:id,name', 'productBrand:id,name']);

        if (filled($filters['search'] ?? null)) {
            $like = $this->likeTerm((string) $filters['search']);
            $query->where(fn ($q) => $q
                ->where('name', 'like', $like)
                ->orWhere('name_en', 'like', $like)
                ->orWhere('sku', 'like', $like)
                ->orWhere('barcode', 'like', $like));
        }

        if (filled($filters['sku'] ?? null)) {
            $query->where('sku', $filters['sku']);
        }
        if (filled($filters['barcode'] ?? null)) {
            $query->where('barcode', $filters['barcode']);
        }
        if (filled($filters['type'] ?? null)) {
            $query->where('type', $filters['type']);
        }
        if (array_key_exists('is_active', $filters) && $filters['is_active'] !== null && $filters['is_active'] !== '') {
            $query->where('is_active', filter_var($filters['is_active'], FILTER_VALIDATE_BOOLEAN));
        }

        $this->applySort($query, $filters['sort'] ?? null, self::SORTS, 'name');

        return PublicApiResponse::paginated($request, $query->paginate($this->perPage($request)), PublicProductResource::class);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $product = Product::with(['productCategory:id,name', 'productBrand:id,name'])->findOrFail($id);

        return PublicApiResponse::resource($request, new PublicProductResource($product));
    }
}
