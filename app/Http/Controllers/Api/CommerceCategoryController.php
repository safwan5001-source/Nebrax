<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontCategoryResource;
use App\Models\CommerceCategoryListing;
use App\Models\ProductCategory;
use App\Support\PublicApiResponse;
use App\Tenancy\BranchScope;
use App\Tenancy\StorefrontContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public/Mobile Commerce API V1 — PR-2 (Read-only Catalog: categories).
 *
 * A new, thin controller for the `/commerce/v1` trust boundary — not a reuse
 * of `StorefrontCategoryController` itself, matching PR-1's established
 * "share services, not controllers" separation (architecture doc §3.1).
 * Reuses `StorefrontCategoryResource` directly — a pure data projection with
 * zero host/channel-specific logic — rather than a second, duplicate resource
 * class.
 *
 * COM-CATALOG-2: categories are now gated per resolved sales channel by
 * `CommerceCategoryListing.is_published` (exactly as the web storefront is),
 * on the mobile channel resolved by `ResolveCommerceChannel` — never from
 * client input. Product publication (`CommerceListing`) stays a separate,
 * independent gate in `CommerceProductController`.
 */
class CommerceCategoryController extends PublicApiController
{
    private const MAX_ANCESTOR_DEPTH = 10;

    public function index(Request $request): JsonResponse
    {
        $publishedIds = $this->publishedCategoryIds();

        $categories = ProductCategory::query()
            ->withoutGlobalScope(BranchScope::class)
            ->whereNull('parent_id')
            ->where('is_active', true)
            ->whereIn('id', $publishedIds)
            ->with([
                'children' => fn ($q) => $q->where('is_active', true)->whereIn('id', $publishedIds)->with([
                    'children' => fn ($q2) => $q2->where('is_active', true)->whereIn('id', $publishedIds),
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
        $publishedIds = $this->publishedCategoryIds();

        $category = ProductCategory::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', $publishedIds)
            ->with(['children' => fn ($q) => $q->where('is_active', true)->whereIn('id', $publishedIds)])
            ->find($id);

        if ($category === null) {
            abort(404, 'التصنيف غير موجود.');
        }

        $ancestors = [];
        $cursor = $category->parent_id;
        $depth = 0;
        while ($cursor !== null && $depth < self::MAX_ANCESTOR_DEPTH) {
            $parent = ProductCategory::query()
                ->withoutGlobalScope(BranchScope::class)
                ->whereIn('id', $publishedIds)
                ->find($cursor);
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

    /** معرّفات التصنيفات المنشورة على قناة الجوال المحلولة من السياق الموثوق. */
    private function publishedCategoryIds(): Builder
    {
        return CommerceCategoryListing::publishedOn(app(StorefrontContext::class)->salesChannelId())
            ->select('category_id');
    }
}
