<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontCategoryResource;
use App\Models\ProductCategory;
use App\Support\PublicApiResponse;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public/Mobile Commerce API V1 — PR-2 (Read-only Catalog: categories).
 *
 * A new, thin controller for the `/commerce/v1` trust boundary — not a reuse
 * of `StorefrontCategoryController` itself, matching PR-1's established
 * "share services, not controllers" separation (architecture doc §3.1) —
 * but the query it runs is genuinely unchanged: categories carry no
 * publication or channel gate at all (`CommerceListing.is_published`
 * governs only products; a category tree is shared browsing structure
 * across every channel by design, per `StorefrontCategoryController`'s own
 * docblock). Reuses `StorefrontCategoryResource` directly — a pure data
 * projection with zero host/channel-specific logic — rather than a second,
 * duplicate resource class.
 */
class CommerceCategoryController extends PublicApiController
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
