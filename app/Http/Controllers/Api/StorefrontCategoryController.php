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
 * Public storefront catalog — التصنيفات (COM-7-P1)، قراءة عامة مجهولة فقط.
 *
 * COM-CATALOG-2 — حراسة نشر على مستوى التصنيف نفسه: تصنيفٌ يظهر فقط إن كان
 * `is_active` **و** له `CommerceCategoryListing` منشور (`is_published = true`)
 * على القناة المحلولة من الرابط (`StorefrontContext`). الحراسة مستقلة تماماً
 * عن حراسة المنتج (`CommerceListing.is_published` في
 * `StorefrontProductController`) — لا أيٌّ منهما يغيّر الآخر. المصدر الوحيد
 * للحقيقة هو الجدول نفسه (لا fallback)؛ التوافق الرجعي حُسم بالـ backfill في
 * الترحيل `2026_10_05_010000_create_commerce_category_listings_table`.
 */
class StorefrontCategoryController extends PublicApiController
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
        // يُقرأ صراحةً من الطلب لا كوسيط مربوط بالاسم — انظر تعليق
        // StorefrontProductController::show() حول هشاشة حسم Laravel لمواضع
        // معاملات الطريق مع `{tenantSlug}` غير مُعلَنة في التوقيع.
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
            // سياق التنقّل (breadcrumb) يخضع لنفس بوابة النشر — تصنيفٌ غير
            // منشور لا يظهر حتى كأبٍ في مسار تصنيف منشور.
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

    /**
     * استعلام فرعي لمعرّفات التصنيفات المنشورة على القناة المحلولة من سياق
     * المتجر الموثوق — يُعاد استخدامه في كل مستويات الشجرة فتبقى البوابة
     * حتمية ومتسقة.
     */
    private function publishedCategoryIds(): Builder
    {
        return CommerceCategoryListing::publishedOn(app(StorefrontContext::class)->salesChannelId())
            ->select('category_id');
    }
}
