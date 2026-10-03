<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceProductContentBlock;
use App\Models\Product;
use App\Services\Commerce\ProductContentService;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * FLOWERS-H5 / ADR-17 — كتل المحتوى المهيكلة لمنتج: قراءة (`products.view`) واستبدال ذرّي
 * (`products.manage`). `{id}` محدِّد منتج فقط والملكية عبر `TenantScope` (404 غير كاشف).
 */
final class CommerceProductContentController extends ApiController
{
    public function show(Request $request, ProductContentService $content, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $product = Product::query()->findOrFail($id);

        return response()->json(['data' => ['blocks' => $content->blocks($product)]]);
    }

    public function replace(Request $request, ProductContentService $content, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'blocks' => ['present', 'array', 'max:'.count(CommerceProductContentBlock::TYPES)],
            'blocks.*.block_type' => ['required', 'string', Rule::in(CommerceProductContentBlock::TYPES)],
            'blocks.*.body' => ['required', 'string', 'max:'.(CommerceProductContentBlock::MAX_BODY_LENGTH * 2), 'regex:/\S/'],
            'blocks.*.body_en' => ['sometimes', 'nullable', 'string', 'max:'.(CommerceProductContentBlock::MAX_BODY_LENGTH * 2)],
            'blocks.*.is_active' => ['sometimes', 'boolean'],
        ]);
        $product = Product::query()->findOrFail($id);

        try {
            $blocks = $content->replace($product, array_values($data['blocks']));
        } catch (DomainException $e) {
            abort(422, $e->getMessage());
        }

        return response()->json(['data' => ['blocks' => $blocks]]);
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'إدارة محتوى المنتج غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
