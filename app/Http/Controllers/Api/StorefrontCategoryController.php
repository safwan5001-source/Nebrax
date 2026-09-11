<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontCategoryResource;
use App\Models\ProductCategory;
use App\Support\PublicApiResponse;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public storefront catalog — التصنيفات (COM-7-P1)، قراءة عامة مجهولة فقط.
 *
 * لا حراسة نشر على مستوى التصنيف نفسه — بنية تصفّح مشتركة عبر القنوات؛
 * حراسة النشر تبقى حصراً على مستوى المنتج (`CommerceListing.is_published`)
 * في `StorefrontProductController`. تُستثنى التصنيفات المعطّلة فقط.
 */
class StorefrontCategoryController extends PublicApiController
{
    private const MAX_ANCESTOR_DEPTH = 10;

    public function index(Request $request): JsonResponse
    {
        $categories = ProductCategory::query()
            ->withoutGlobalScope(BranchScope::class)
            ->whereNull('parent_id')
            ->where('is_active', true)
            ->with([
                'children' => fn ($q) => $q->where('is_active', true)->with([
                    'children' => fn ($q2) => $q2->where('is_active', true),
                ]),
            ])
            ->orderBy('name')
            ->get();

        $data = $categories
            ->map(fn (ProductCategory $category) => (new StorefrontCategoryResource($category, 2))->resolve($request))
            ->values()
            ->all();

        return new JsonResponse([
            'data' => $data,
            'meta' => ['request_id' => PublicApiResponse::requestId($request)],
        ]);
    }

    public function show(Request $request): JsonResponse
    {
        // يُقرأ صراحةً من الطلب لا كوسيط مربوط بالاسم — انظر تعليق
        // StorefrontProductController::show() حول هشاشة حسم Laravel لمواضع
        // معاملات الطريق مع `{tenantSlug}` غير مُعلَنة في التوقيع.
        $id = (string) $request->route('id');

        $category = ProductCategory::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->with(['children' => fn ($q) => $q->where('is_active', true)])
            ->find($id);

        if ($category === null) {
            abort(404, 'التصنيف غير موجود.');
        }

        $ancestors = [];
        $cursor = $category->parent_id;
        $depth = 0;
        while ($cursor !== null && $depth < self::MAX_ANCESTOR_DEPTH) {
            $parent = ProductCategory::query()->withoutGlobalScope(BranchScope::class)->find($cursor);
            if ($parent === null) {
                break;
            }
            $ancestors[] = $parent;
            $cursor = $parent->parent_id;
            $depth++;
        }

        $resource = new StorefrontCategoryResource($category, 1, array_reverse($ancestors));

        return PublicApiResponse::resource($request, $resource);
    }
}
