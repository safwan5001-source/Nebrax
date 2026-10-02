<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontCategoryResource;
use App\Models\CommerceCategoryListing;
use App\Models\ProductCategory;
use App\Models\Storefront;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CUST-H2-4 — قراءة تصنيفات مساحة عمل Commerce للمعاينة داخل مُخصِّص صفحة
 * التصنيف (Preview Category picker). **قراءة فقط**؛ لا فعلٌ كتابي هنا، ولا
 * سلطة نشر/شجرة/عضوية منتج — معرّف التصنيف مُحدِّدٌ (selector) لا سلطة.
 *
 * نسخة طبق الأصل من نمط `CommerceWorkspaceStorefrontProductController`
 * (CUST-H2-3): نفس سلسلة المصادقة، نفس `ownedStorefront()`، نفس منطق 404
 * غير المُسرِّب. الفرق الوحيد الجوهري هو مصدر الأهلية — `CommerceCategoryListing`
 * بدل `CommerceListing` — بنفس القاعدة التي يفرضها `StorefrontCategoryController`
 * العام اليوم على قناته المحلولة من الاستضافة، مطبَّقة هنا على قناة *المتجر
 * المفتوح في المُخصِّص تحديداً* بدل قناة الاستضافة.
 *
 * **قاعدة الأهلية**: تصنيفٌ مؤهَّل للمعاينة على متجرٍ بعينه إن وفقط إن كان
 * نشطاً (`is_active = true`) وله `CommerceCategoryListing` منشور
 * (`is_published = true`) على **نفس قناة بيع هذا المتجر تحديداً**. تصنيفٌ من
 * مستأجرٍ آخر، أو غير نشط، أو غير منشور على قناة هذا المتجر بعينها (بما فيه
 * منشورٌ على قناة *أخرى* لنفس المستأجر) → 404 لا 403، بلا تسريب وجود جزئي.
 *
 * **عزل الفروع**: `ProductCategory` مصنَّفٌ `BranchShareable`/`BranchScoped`
 * (بنفس مفتاح مشاركة `Product`, `share_products` — راجع تعليق النموذج نفسه:
 * ربطه بمفتاح آخر كان سيسمح بحالة فاسدة). هذا المتحكّم **لا** يتجاوز نطاق
 * الفرع (`withoutGlobalScope(BranchScope::class)`) كما يفعل
 * `StorefrontCategoryController` العام — ذاك مجهولٌ لا سياق فرع له أصلاً؛
 * هذا يعمل داخل مساحة عمل موثَّقة بفرعٍ نشطٍ حقيقي (`SetBranch`)، فيطابق
 * تماماً القرار الذي اتّخذه `CommerceWorkspaceStorefrontProductController`
 * لـ`Product` (نفس التصنيف الفرعي بالضبط) — لا حالة جديدة تُخترع هنا.
 *
 * **الحمولة**: القائمة مُصغَّرة (معرّف/اسم/تلميح تسلسل هرمي فقط) — لا حمولة
 * تصنيف كاملة لمجرَّد منتقٍ. التفصيل يعيد استخدام `StorefrontCategoryResource`
 * نفسه (نفس مورد الكتالوج العام) — بما أن مسار مساحة العمل هذا لا يحمل اسم
 * مسار `storefront.v1.*`، يُسقِط المورد حقل `image` تلقائياً بمنطقه القائم
 * (`isStorefrontRequest()`) — يطابق «صورة غلاف التصنيف مؤجَّلة» في هذه الشريحة
 * دون أي منطق إضافي هنا.
 *
 * **CUST-H4-3 (تصحيح التكافؤ) — `root_only=true`**: إضافيٌّ واختياري
 * بالكامل؛ غيابه يُبقي السلوك الافتراضي (قائمة مختلطة الأعماق) كما هو حرفياً
 * لكل مستدعٍ قائم (منتقي صفحة التصنيف). الفلتر `whereNull('parent_id')`
 * يُطبَّق **قبل** `paginate()` لا بعده — هذا هو الفارق الجوهري عن ترشيح طرف
 * العميل: صفحةٌ أولى مزدحمة بتصنيفات فرعية لن «تُجوِّع» تصنيفات رئيسية تقع
 * بعدها أبجدياً. مُخصِّص الواجهة يستعمله لمعاينة قسم «التصنيفات» الحقيقي على
 * الصفحة الرئيسية، ليطابق `depth_eq: 0` الذي تستعمله الواجهة المنشورة فعلاً
 * (`StorefrontCategoryController`/`CategoriesSection.tsx`) — لا معنى جديد
 * يُخترع هنا، ونفس مبدأ `sort=newest` الذي أضافه
 * `CommerceWorkspaceStorefrontProductController` لنفس السبب بالضبط.
 */
class CommerceWorkspaceStorefrontCategoryController extends ApiController
{
    private const PER_PAGE_DEFAULT = 20;

    private const PER_PAGE_MAX = 50;

    private const MAX_ANCESTOR_DEPTH = 10;

    public function index(Request $request, string $id): JsonResponse
    {
        $this->denySelfService($request);

        $storefront = $this->ownedStorefront($id);
        if ($storefront === null) {
            abort(404, 'المتجر غير موجود.');
        }

        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            // CUST-H4-3 (parity fix) — additive and opt-in only. Every
            // existing caller (the Category-page preview picker) omits it
            // and keeps today's mixed-depth list unchanged. When present,
            // the `whereNull('parent_id')` filter below is applied *before*
            // `paginate()`, so a page is never filled with non-root rows
            // that then starve root categories off the end of the result —
            // the exact parity gap a client-side filter-after-fetch would
            // have left open.
            //
            // Deliberately `in:true,false,1,0` rather than the bare
            // `boolean` rule this codebase's other boolean filters use
            // (e.g. `PublicProductController`'s `is_active`): Laravel's
            // `boolean` rule only accepts the literal values
            // `[true, false, 0, 1, '0', '1']` (strict comparison) — it
            // rejects the query-string `"true"`/`"false"` a URL literally
            // spelling `root_only=true` sends, which is both this slice's
            // own URL (and every `URLSearchParams`-built request from the
            // web client, which serializes a JS boolean as that exact
            // string) — accepting only `1`/`0` here would 422 on the one
            // request shape this fix exists to serve.
            'root_only' => ['sometimes', 'nullable', 'string', 'in:true,false,1,0'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:'.self::PER_PAGE_MAX],
        ]);

        $query = ProductCategory::query()
            ->where('is_active', true)
            ->whereIn('id', $this->publishedCategoryIds($storefront->sales_channel_id))
            ->with(['parent:id,name'])
            ->orderBy('name')
            ->orderBy('id');

        if (filled($filters['search'] ?? null)) {
            $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], (string) $filters['search']).'%';
            $query->where('name', 'like', $like);
        }

        if ($request->boolean('root_only')) {
            $query->whereNull('parent_id');
        }

        $perPage = min((int) ($filters['per_page'] ?? self::PER_PAGE_DEFAULT), self::PER_PAGE_MAX);
        $paginator = $query->paginate($perPage, ['*'], 'page', (int) ($filters['page'] ?? 1));

        $data = $paginator->getCollection()->map(fn (ProductCategory $category) => [
            'id' => $category->id,
            'name' => $category->name,
            'parent_id' => $category->parent_id,
            'parent_name' => $category->parent?->name,
        ])->all();

        return response()->json([
            'data' => $data,
            'meta' => [
                'pagination' => [
                    'page' => $paginator->currentPage(),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                    'last_page' => $paginator->lastPage(),
                    'has_more' => $paginator->hasMorePages(),
                ],
            ],
        ]);
    }

    public function show(Request $request, string $id, string $category): JsonResponse
    {
        $this->denySelfService($request);

        $storefront = $this->ownedStorefront($id);
        if ($storefront === null) {
            abort(404, 'المتجر غير موجود.');
        }

        $publishedIds = $this->publishedCategoryIds($storefront->sales_channel_id);

        $categoryModel = ProductCategory::query()
            ->where('is_active', true)
            ->whereIn('id', $publishedIds)
            ->with(['children' => fn ($q) => $q->where('is_active', true)->whereIn('id', $publishedIds)])
            ->find($category);

        if ($categoryModel === null) {
            abort(404, 'التصنيف غير موجود.');
        }

        // مسار الأجداد يخضع لنفس بوابة النشر تماماً — تصنيفٌ غير منشور لا
        // يظهر حتى كأبٍ في مسار breadcrumb لتصنيفٍ منشور، مطابقاً
        // `StorefrontCategoryController::show()` حرفياً.
        $ancestors = [];
        $cursor = $categoryModel->parent_id;
        $depth = 0;
        while ($cursor !== null && $depth < self::MAX_ANCESTOR_DEPTH) {
            $parent = ProductCategory::query()->whereIn('id', $publishedIds)->find($cursor);
            if ($parent === null) {
                break;
            }
            $ancestors[] = $parent;
            $cursor = $parent->parent_id;
            $depth++;
        }

        $resource = new StorefrontCategoryResource($categoryModel, 1, array_reverse($ancestors));

        return response()->json(['data' => $resource->resolve($request)]);
    }

    /**
     * استعلام فرعي لمعرّفات التصنيفات المنشورة على قناة *هذا المتجر تحديداً* —
     * `CommerceCategoryListing::publishedOn()` نفسها التي يستعملها المسار
     * العام، مطبَّقة على `Storefront.sales_channel_id` بدل القناة المحلولة من
     * الاستضافة.
     */
    private function publishedCategoryIds(string $salesChannelId): Builder
    {
        return CommerceCategoryListing::publishedOn($salesChannelId)->select('category_id');
    }

    /**
     * مطابقٌ لـ`CommerceWorkspaceStorefrontProductController::ownedStorefront()`
     * حرفياً — نفس نمط `StorefrontPresentationVersionService::ownedStorefront()`.
     */
    private function ownedStorefront(string $storefrontId): ?Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            return null;
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        return $storefront;
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
