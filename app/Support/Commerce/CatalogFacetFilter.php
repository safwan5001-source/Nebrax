<?php

namespace App\Support\Commerce;

use App\Models\Brand;
use App\Models\CommerceCollection;
use App\Models\CommerceFacet;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * FLOWERS-H2 / ADR-14 — ترشيح الكتالوج العام بالأبعاد الوصفية والعلامة التجارية.
 *
 * مصدر الحقيقة الوحيد لدلالات الترشيح، تستعمله قوائم `store/v1` و`commerce/v1`
 * معاً (نفس فكرة `ProductListFilters`). الدلالات:
 *  - `facet[<key>]=slug1,slug2`: **OR داخل البُعد، AND بين الأبعاد**.
 *  - بُعد/قيمة مجهولة أو معطَّلة ⇒ نتيجة فارغة (فشل مغلق)، لا تجاهل صامت للمرشّح.
 *  - `brand_id` يتركّب بـAND مع الباقي.
 *  - العدّ **تفريقي** (disjunctive): اختيار بُعدٍ لا يضيّق عدّ قيمه هو.
 *
 * بوابة النشر (`CommerceListing`) تسبق هذا كله في المتحكّم؛ لا مرشّح هنا يكشف
 * منتجاً غير منشور. الاستعلامات مجمّعة لا لكل منتج: واحد لكل بُعد نشط (محدود
 * بـ30) + واحد للعلامات.
 */
final class CatalogFacetFilter
{
    public const MAX_SELECTED_FACETS = 10;

    public const MAX_SLUGS_PER_FACET = 20;

    /** @var array<string, CommerceFacet>|null */
    private ?array $activeFacets = null;

    /** @var array<string, bool> */
    private array $activeBrands = [];

    /**
     * قواعد التحقق المشتركة للمتحكّمين العامين.
     *
     * @return array<string, array<int, string>>
     */
    public static function rules(): array
    {
        return [
            'brand_id' => ['sometimes', 'nullable', 'uuid'],
            'collection' => ['sometimes', 'nullable', 'string', 'max:64'],
            'facet' => ['sometimes', 'nullable', 'array', 'max:'.self::MAX_SELECTED_FACETS],
            'facet.*' => ['nullable', 'string', 'max:1000', static function (string $attribute, mixed $value, \Closure $fail): void {
                // رفضٌ صريح بدل البتر الصامت: بترُ ما بعد العشرين كان سيُسقط slug مجهولاً ويُخلّ بالفشل المغلق.
                if (is_string($value) && count(self::slugsOf($value)) > self::MAX_SLUGS_PER_FACET) {
                    $fail('عدد قيم البُعد الواحد يتجاوز '.self::MAX_SLUGS_PER_FACET.'.');
                }
            }],
        ];
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array{brand_id: ?string, collection: ?string, facets: array<string, list<string>>}
     */
    public static function selection(array $validated): array
    {
        $facets = [];
        foreach ((array) ($validated['facet'] ?? []) as $key => $raw) {
            // مدخلٌ فارغ (`facet[x]=` أو `,,,`) يُحفظ بقيمٍ فارغة فيُنتج apply() نتيجةً فارغة (فشل مغلق)،
            // لا أن يُسقَط فيُرجع الكتالوج غير المصفّى.
            $facets[(string) $key] = is_string($raw) ? self::slugsOf($raw) : [];
        }

        return [
            // UUID بأحرف كبيرة يجتاز التحقق؛ نوحّده للشكل المعياري قبل البحث والمقارنة (SQLite نصّيّ).
            'brand_id' => filled($validated['brand_id'] ?? null) ? strtolower((string) $validated['brand_id']) : null,
            'collection' => filled($validated['collection'] ?? null) ? (string) $validated['collection'] : null,
            'facets' => $facets,
        ];
    }

    /** @return list<string> */
    private static function slugsOf(string $raw): array
    {
        return array_values(array_unique(array_filter(array_map('trim', explode(',', $raw)), static fn ($s) => $s !== '')));
    }

    /** @param array{brand_id: ?string, collection: ?string, facets: array<string, list<string>>} $selection */
    public function isActive(array $selection): bool
    {
        return $selection['brand_id'] !== null || $selection['collection'] !== null || $selection['facets'] !== [];
    }

    /**
     * سياق المجموعة (`collection=<slug>`): قيد **سياقي** كالتصنيف لا بُعد ترشيح —
     * يُطبَّق على الاستعلام الأساسي قبل العدّ فتُحسب الأبعاد داخل المجموعة. مجموعة
     * مجهولة أو غير مفعَّلة ⇒ نتيجة فارغة (فشل مغلق).
     *
     * @param  array{brand_id: ?string, collection: ?string, facets: array<string, list<string>>}  $selection
     */
    public function applyCollection(Builder $products, array $selection): void
    {
        if ($selection['collection'] === null) {
            return;
        }

        $collectionId = CommerceCollection::query()
            ->where('status', CommerceCollection::STATUS_ACTIVE)
            ->where('slug', $selection['collection'])
            ->value('id');

        if ($collectionId === null) {
            $products->whereRaw('0 = 1');

            return;
        }

        $products->whereExists(function ($exists) use ($collectionId): void {
            $exists->from('commerce_collection_products as ccp')
                ->selectRaw('1')
                ->whereColumn('ccp.product_id', 'products.id')
                ->where('ccp.commerce_collection_id', $collectionId);
        });
    }

    /** ترتيب أعضاء المجموعة كما رتّبها التاجر (يُستعمل حين لا `sort` صريح). */
    public function orderByCollectionPosition(Builder $products, array $selection): void
    {
        if ($selection['collection'] === null) {
            return;
        }

        $collectionId = CommerceCollection::query()
            ->where('status', CommerceCollection::STATUS_ACTIVE)
            ->where('slug', $selection['collection'])
            ->value('id');

        if ($collectionId === null) {
            return;
        }

        $products->orderByRaw(
            '(select ccp.position from commerce_collection_products as ccp where ccp.product_id = products.id and ccp.commerce_collection_id = ?) asc',
            [$collectionId],
        );
    }

    /**
     * يطبّق الاختيار على استعلام المنتجات.
     *
     * @param  array{brand_id: ?string, collection: ?string, facets: array<string, list<string>>}  $selection
     */
    public function apply(Builder $products, array $selection, ?string $exceptFacetKey = null, bool $withBrand = true): void
    {
        if ($withBrand && $selection['brand_id'] !== null) {
            // علامة غير نشطة/مجهولة ⇒ فارغ (فشل مغلق): لا نُبقي مرشّحاً لا تعرضه meta.brands ولا يمكن إلغاؤه.
            if (! $this->isActiveBrand($selection['brand_id'])) {
                $products->whereRaw('0 = 1');

                return;
            }
            $products->where('products.brand_id', $selection['brand_id']);
        }

        $active = $this->activeFacets();
        foreach ($selection['facets'] as $key => $slugs) {
            if ($key === $exceptFacetKey) {
                continue;
            }

            $facet = $active[$key] ?? null;
            $valueIds = $facet === null
                ? []
                : $facet->values->whereIn('slug', $slugs)->pluck('id')->all();

            // أي slug مجهول أو غير نشط ⇒ نتيجة فارغة (مغلق عند الفشل)، لا تجاهلٌ صامت له.
            if ($valueIds === [] || count($valueIds) !== count($slugs)) {
                $products->whereRaw('0 = 1');

                return;
            }

            $products->whereExists(function ($exists) use ($valueIds): void {
                $exists->from('commerce_product_facet_values as cpfv')
                    ->selectRaw('1')
                    ->whereColumn('cpfv.product_id', 'products.id')
                    ->whereIn('cpfv.commerce_facet_value_id', $valueIds);
            });
        }
    }

    /**
     * `meta.facets` + `meta.brands` بعدٍّ تفريقي فوق الاستعلام الأساسي (بوابة
     * النشر + البحث + التصنيف، **بلا** brand/facets).
     *
     * @param  array{brand_id: ?string, collection: ?string, facets: array<string, list<string>>}  $selection
     * @return array{facets: list<array<string, mixed>>, brands: list<array<string, mixed>>}
     */
    public function meta(Builder $base, array $selection): array
    {
        return [
            'facets' => $this->facetCounts($base, $selection),
            'brands' => $this->brandCounts($base, $selection),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function facetCounts(Builder $base, array $selection): array
    {
        $tenantId = app(TenantContext::class)->id();
        $out = [];

        foreach ($this->activeFacets() as $key => $facet) {
            if ($facet->values->isEmpty()) {
                continue;
            }

            $scope = clone $base;
            $this->apply($scope, $selection, $key);

            $counts = DB::table('commerce_product_facet_values as cpfv')
                ->joinSub($scope->select('products.id'), 'p', 'p.id', '=', 'cpfv.product_id')
                ->where('cpfv.tenant_id', $tenantId)
                ->whereIn('cpfv.commerce_facet_value_id', $facet->values->pluck('id'))
                ->groupBy('cpfv.commerce_facet_value_id')
                ->selectRaw('cpfv.commerce_facet_value_id as value_id, count(distinct cpfv.product_id) as aggregate')
                ->pluck('aggregate', 'value_id');

            $selected = $selection['facets'][$key] ?? [];
            $values = $facet->values
                ->map(fn ($value) => [
                    'slug' => $value->slug,
                    'name' => $value->name,
                    'name_en' => $value->name_en,
                    'count' => (int) ($counts[$value->id] ?? 0),
                    'selected' => in_array($value->slug, $selected, true),
                ])
                ->filter(fn (array $value) => $value['count'] > 0 || $value['selected'])
                ->values()
                ->all();

            if ($values === []) {
                continue;
            }

            $out[] = [
                'key' => $facet->key,
                'system_key' => $facet->system_key,
                'name' => $facet->name,
                'name_en' => $facet->name_en,
                'values' => $values,
            ];
        }

        return $out;
    }

    /** @return list<array<string, mixed>> */
    private function brandCounts(Builder $base, array $selection): array
    {
        $scope = clone $base;
        $this->apply($scope, $selection, null, false);

        $counts = $scope
            ->whereNotNull('products.brand_id')
            ->groupBy('products.brand_id')
            ->select('products.brand_id', DB::raw('count(*) as aggregate'))
            ->pluck('aggregate', 'brand_id');

        // العلامة المختارة تبقى ظاهرةً بعدّاد صفر ليتمكّن العميل من رؤيتها وإلغائها.
        $ids = $counts->keys()->all();
        if ($selection['brand_id'] !== null) {
            $ids[] = $selection['brand_id'];
        }
        if ($ids === []) {
            return [];
        }

        return Brand::query()
            ->withoutGlobalScope(BranchScope::class)
            ->whereIn('id', array_values(array_unique($ids)))
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (Brand $brand) => [
                'id' => $brand->id,
                'name' => $brand->name,
                'count' => (int) ($counts[$brand->id] ?? 0),
                'selected' => $selection['brand_id'] === $brand->id,
            ])
            ->values()
            ->all();
    }

    private function isActiveBrand(string $brandId): bool
    {
        return $this->activeBrands[$brandId] ??= Brand::query()
            ->withoutGlobalScope(BranchScope::class)
            ->whereKey($brandId)
            ->where('is_active', true)
            ->exists();
    }

    /** @return array<string, CommerceFacet> نشطة بقيمها النشطة، مفهرسة بالمفتاح — تُحمَّل مرة لكل طلب. */
    private function activeFacets(): array
    {
        return $this->activeFacets ??= CommerceFacet::query()
            ->where('is_active', true)
            ->with(['values' => fn ($q) => $q->where('is_active', true)])
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->keyBy('key')
            ->all();
    }
}
