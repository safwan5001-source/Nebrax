<?php

namespace App\Services\Commerce;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceProductFacetValue;
use App\Models\Product;
use App\Support\Commerce\CatalogSlug;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * FLOWERS-H2 / ADR-14 — إدارة الأبعاد الوصفية (Facets) وقيمها وإسنادها للمنتجات.
 *
 * المنتج يبقى سيّد البيانات؛ هذه الخدمة لا تلمس سعراً ولا مخزوناً ولا نشراً ولا
 * أي أثر محاسبي. العزل: كل الاستعلامات تمرّ بـ`TenantScope` + تحقق بنيوي في
 * النماذج. تعطيل بُعد/قيمة **يحتفظ بالإسنادات**؛ الحذف مرفوض ما دامت القيمة مسندة.
 *
 * @phpstan-type FacetRow array{id: string, key: string, system_key: ?string, name: string, name_en: ?string, sort_order: int, is_active: bool, values: list<array<string, mixed>>}
 */
final class CommerceFacetService
{
    public const MAX_FACETS = 30;

    public const MAX_VALUES_PER_FACET = 200;

    public const MAX_ASSIGNMENTS_PER_PRODUCT = 100;

    /** @return list<array<string, mixed>> */
    public function list(): array
    {
        $tenantId = $this->tenantId();

        $counts = DB::table('commerce_product_facet_values')
            ->where('tenant_id', $tenantId)
            ->selectRaw('commerce_facet_value_id, count(*) as aggregate')
            ->groupBy('commerce_facet_value_id')
            ->pluck('aggregate', 'commerce_facet_value_id');

        return CommerceFacet::query()
            ->with('values')
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->map(fn (CommerceFacet $facet) => $this->presentFacet($facet, $counts))
            ->values()
            ->all();
    }

    /** @param array{key: string, name: string, name_en?: ?string, system_key?: ?string, sort_order?: int, is_active?: bool} $data */
    public function createFacet(array $data): array
    {
        $this->tenantId();

        if (CommerceFacet::query()->count() >= self::MAX_FACETS) {
            throw new CommerceTaxonomyConflictException('بلغت الحد الأقصى لعدد الأبعاد.');
        }

        try {
            // معاملة (savepoint عند التداخل) كي لا ينتهك القيد الفريد معاملةً خارجية قائمة (PostgreSQL).
            $facet = DB::transaction(fn () => CommerceFacet::create([
                'key' => $data['key'],
                'system_key' => $data['system_key'] ?? null,
                'name' => trim($data['name']),
                'name_en' => $this->nullableTrim($data['name_en'] ?? null),
                'sort_order' => $data['sort_order'] ?? 0,
                'is_active' => $data['is_active'] ?? true,
            ]));
        } catch (QueryException $e) {
            throw $this->uniqueOr($e, 'المفتاح أو البُعد النظامي مستخدم بالفعل.');
        }

        return $this->presentFacet($facet->load('values'), collect());
    }

    /** @param array{name?: string, name_en?: ?string, sort_order?: int, is_active?: bool} $data */
    public function updateFacet(string $facetId, array $data): ?array
    {
        $facet = CommerceFacet::query()->find($facetId);
        if ($facet === null) {
            return null;
        }

        $update = [];
        if (array_key_exists('name', $data)) {
            $update['name'] = trim((string) $data['name']);
        }
        if (array_key_exists('name_en', $data)) {
            $update['name_en'] = $this->nullableTrim($data['name_en']);
        }
        foreach (['sort_order', 'is_active'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = $data[$field];
            }
        }
        if ($update !== []) {
            $facet->forceFill($update)->save();
        }

        return $this->presentFacet($facet->load('values'), $this->valueCounts($facet));
    }

    /** @return bool|null null = غير موجود */
    public function deleteFacet(string $facetId): ?bool
    {
        $facet = CommerceFacet::query()->with('values')->find($facetId);
        if ($facet === null) {
            return null;
        }

        $valueIds = $facet->values->pluck('id')->all();
        if ($valueIds !== [] && DB::table('commerce_product_facet_values')->whereIn('commerce_facet_value_id', $valueIds)->exists()) {
            throw new CommerceTaxonomyConflictException('لا يمكن حذف بُعد له منتجات مُسنَدة — عطّله بدلاً من ذلك.');
        }

        $facet->delete();

        return true;
    }

    /** @param array{name: string, name_en?: ?string, slug?: ?string, sort_order?: int, is_active?: bool} $data */
    public function createValue(string $facetId, array $data): ?array
    {
        $facet = CommerceFacet::query()->find($facetId);
        if ($facet === null) {
            return null;
        }

        if (CommerceFacetValue::query()->where('commerce_facet_id', $facet->id)->count() >= self::MAX_VALUES_PER_FACET) {
            throw new CommerceTaxonomyConflictException('بلغت الحد الأقصى لعدد قيم هذا البُعد.');
        }

        $name = trim($data['name']);
        $nameEn = $this->nullableTrim($data['name_en'] ?? null);
        $this->assertNameUnique($facet, $name, $nameEn, null);

        $explicit = filled($data['slug'] ?? null);
        $slug = $explicit ? (string) $data['slug'] : $this->deriveSlug($facet, $nameEn ?? $name);
        if ($explicit && $this->slugTaken($facet, $slug, null)) {
            throw new CommerceTaxonomyConflictException('المعرّف النصي (slug) مستخدم بالفعل في هذا البُعد.');
        }

        try {
            $value = DB::transaction(fn () => CommerceFacetValue::create([
                'commerce_facet_id' => $facet->id,
                'slug' => $slug,
                'name' => $name,
                'name_en' => $nameEn,
                'sort_order' => $data['sort_order'] ?? 0,
                'is_active' => $data['is_active'] ?? true,
            ]));
        } catch (QueryException $e) {
            throw $this->uniqueOr($e, 'المعرّف النصي (slug) مستخدم بالفعل في هذا البُعد.');
        }

        return $this->presentValue($value, 0);
    }

    /** @param array{name?: string, name_en?: ?string, slug?: string, sort_order?: int, is_active?: bool} $data */
    public function updateValue(string $facetId, string $valueId, array $data): ?array
    {
        $value = CommerceFacetValue::query()
            ->where('commerce_facet_id', $facetId)
            ->find($valueId);
        if ($value === null) {
            return null;
        }
        $facet = CommerceFacet::query()->findOrFail($facetId);

        $name = array_key_exists('name', $data) ? trim((string) $data['name']) : $value->name;
        $nameEn = array_key_exists('name_en', $data) ? $this->nullableTrim($data['name_en']) : $value->name_en;
        $this->assertNameUnique($facet, $name, $nameEn, $value->id);

        $update = ['name' => $name, 'name_en' => $nameEn];
        if (array_key_exists('slug', $data) && $data['slug'] !== $value->slug) {
            if ($this->slugTaken($facet, (string) $data['slug'], $value->id)) {
                throw new CommerceTaxonomyConflictException('المعرّف النصي (slug) مستخدم بالفعل في هذا البُعد.');
            }
            $update['slug'] = $data['slug'];
        }
        foreach (['sort_order', 'is_active'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = $data[$field];
            }
        }

        try {
            DB::transaction(fn () => $value->forceFill($update)->save());
        } catch (QueryException $e) {
            throw $this->uniqueOr($e, 'المعرّف النصي (slug) مستخدم بالفعل في هذا البُعد.');
        }

        return $this->presentValue($value, $this->assignedCount($value->id));
    }

    public function deleteValue(string $facetId, string $valueId): ?bool
    {
        $value = CommerceFacetValue::query()->where('commerce_facet_id', $facetId)->find($valueId);
        if ($value === null) {
            return null;
        }

        if ($this->assignedCount($value->id) > 0) {
            throw new CommerceTaxonomyConflictException('لا يمكن حذف قيمة مُسنَدة لمنتجات — عطّلها بدلاً من ذلك.');
        }

        $value->delete();

        return true;
    }

    /** @return list<string> معرّفات القيم المُسنَدة للمنتج */
    public function assignedValueIds(Product $product): array
    {
        $this->assertProductTenant($product);

        return CommerceProductFacetValue::query()
            ->where('product_id', $product->id)
            ->pluck('commerce_facet_value_id')
            ->all();
    }

    /**
     * يستبدل مجموعة إسنادات المنتج (مثاليّ التكرار). القيم الجديدة يجب أن تكون
     * نشطة وببُعد نشط؛ ما كان مُسنَداً يبقى ولو عُطِّل لاحقاً.
     *
     * @param  list<string>  $valueIds
     * @return list<string>
     */
    public function replaceAssignments(Product $product, array $valueIds): array
    {
        $this->assertProductTenant($product);
        $valueIds = array_values(array_unique($valueIds));

        if (count($valueIds) > self::MAX_ASSIGNMENTS_PER_PRODUCT) {
            throw new DomainException('عدد القيم المُسنَدة يتجاوز الحد المسموح.');
        }

        return DB::transaction(function () use ($product, $valueIds) {
            // يُسلسل التعديلات المتزامنة على المنتج نفسه.
            Product::withoutGlobalScopes()->whereKey($product->id)->lockForUpdate()->first();

            $values = CommerceFacetValue::query()->with('facet:id,is_active')->whereIn('id', $valueIds)->get()->keyBy('id');
            if ($values->count() !== count($valueIds)) {
                throw new DomainException('إحدى قيم البُعد المحددة غير موجودة لهذا المستأجر.');
            }

            $current = CommerceProductFacetValue::query()->where('product_id', $product->id)->pluck('commerce_facet_value_id')->all();
            $added = array_values(array_diff($valueIds, $current));
            $removed = array_values(array_diff($current, $valueIds));

            foreach ($added as $id) {
                $value = $values[$id];
                if (! $value->is_active || ! $value->facet?->is_active) {
                    throw new DomainException('لا يمكن إسناد قيمة أو بُعد معطَّل.');
                }
            }

            if ($removed !== []) {
                CommerceProductFacetValue::query()
                    ->where('product_id', $product->id)
                    ->whereIn('commerce_facet_value_id', $removed)
                    ->delete();
            }
            foreach ($added as $id) {
                CommerceProductFacetValue::create(['product_id' => $product->id, 'commerce_facet_value_id' => $id]);
            }

            return $valueIds;
        });
    }

    private function tenantId(): string
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return $tenantId;
    }

    private function assertProductTenant(Product $product): void
    {
        if ($product->tenant_id !== $this->tenantId()) {
            throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
        }
    }

    private function assignedCount(string $valueId): int
    {
        return (int) DB::table('commerce_product_facet_values')->where('commerce_facet_value_id', $valueId)->count();
    }

    private function valueCounts(CommerceFacet $facet)
    {
        return DB::table('commerce_product_facet_values')
            ->whereIn('commerce_facet_value_id', $facet->values()->pluck('id'))
            ->selectRaw('commerce_facet_value_id, count(*) as aggregate')
            ->groupBy('commerce_facet_value_id')
            ->pluck('aggregate', 'commerce_facet_value_id');
    }

    private function assertNameUnique(CommerceFacet $facet, string $name, ?string $nameEn, ?string $exceptId): void
    {
        $needles = array_filter([$this->normalize($name), $nameEn !== null ? $this->normalize($nameEn) : null]);

        $existing = CommerceFacetValue::query()
            ->where('commerce_facet_id', $facet->id)
            ->when($exceptId !== null, fn ($q) => $q->where('id', '!=', $exceptId))
            ->get(['name', 'name_en']);

        foreach ($existing as $row) {
            $names = array_filter([$this->normalize($row->name), $row->name_en !== null ? $this->normalize($row->name_en) : null]);
            if (array_intersect($needles, $names) !== []) {
                throw new CommerceTaxonomyConflictException('توجد قيمة بنفس الاسم في هذا البُعد.');
            }
        }
    }

    private function slugTaken(CommerceFacet $facet, string $slug, ?string $exceptId): bool
    {
        return CommerceFacetValue::query()
            ->where('commerce_facet_id', $facet->id)
            ->where('slug', $slug)
            ->when($exceptId !== null, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();
    }

    private function deriveSlug(CommerceFacet $facet, string $source): string
    {
        return CatalogSlug::derive($source, fn (string $slug) => $this->slugTaken($facet, $slug, null), 'value');
    }

    private function normalize(string $value): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/u', ' ', $value) ?? $value));
    }

    private function nullableTrim(?string $value): ?string
    {
        $value = $value === null ? null : trim($value);

        return $value === '' ? null : $value;
    }

    private function uniqueOr(QueryException $e, string $message): \Throwable
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $driverCode = $e->errorInfo[1] ?? null;
        $isUnique = $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');

        return $isUnique ? new CommerceTaxonomyConflictException($message) : $e;
    }

    private function presentFacet(CommerceFacet $facet, $counts): array
    {
        return [
            'id' => $facet->id,
            'key' => $facet->key,
            'system_key' => $facet->system_key,
            'name' => $facet->name,
            'name_en' => $facet->name_en,
            'sort_order' => $facet->sort_order,
            'is_active' => $facet->is_active,
            'values' => $facet->values->map(fn (CommerceFacetValue $v) => $this->presentValue($v, (int) ($counts[$v->id] ?? 0)))->values()->all(),
        ];
    }

    private function presentValue(CommerceFacetValue $value, int $productCount): array
    {
        return [
            'id' => $value->id,
            'slug' => $value->slug,
            'name' => $value->name,
            'name_en' => $value->name_en,
            'sort_order' => $value->sort_order,
            'is_active' => $value->is_active,
            'product_count' => $productCount,
        ];
    }
}
