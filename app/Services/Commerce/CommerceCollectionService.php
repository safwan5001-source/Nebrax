<?php

namespace App\Services\Commerce;

use App\Models\CommerceCollection;
use App\Models\CommerceCollectionProduct;
use App\Models\Product;
use App\Support\Commerce\CatalogSlug;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * FLOWERS-H2 / ADR-14 §2.3 — إدارة المجموعات التسويقية اليدوية وعضويتها المرتّبة.
 *
 * لا تلمس سعراً ولا مخزوناً ولا نشراً ولا أثراً محاسبياً: المجموعة طبقة عرض فوق
 * منتجات منشورة أصلاً، وبوابة النشر تبقى مصدر الظهور العام.
 */
final class CommerceCollectionService
{
    public const MAX_COLLECTIONS = 100;

    public const MAX_MEMBERS = 200;

    /** @return list<array<string, mixed>> */
    public function list(): array
    {
        $counts = DB::table('commerce_collection_products')
            ->where('tenant_id', $this->tenantId())
            ->selectRaw('commerce_collection_id, count(*) as aggregate')
            ->groupBy('commerce_collection_id')
            ->pluck('aggregate', 'commerce_collection_id');

        return CommerceCollection::query()
            ->orderBy('sort_order')
            ->orderBy('title')
            ->get()
            ->map(fn (CommerceCollection $c) => $this->present($c, (int) ($counts[$c->id] ?? 0)))
            ->values()
            ->all();
    }

    /** @param array{title: string, title_en?: ?string, description?: ?string, slug?: ?string, status?: string, sort_order?: int} $data */
    public function create(array $data): array
    {
        $this->tenantId();

        if (CommerceCollection::query()->count() >= self::MAX_COLLECTIONS) {
            throw new CommerceTaxonomyConflictException('بلغت الحد الأقصى لعدد المجموعات.');
        }

        $titleEn = $this->nullableTrim($data['title_en'] ?? null);
        $explicit = filled($data['slug'] ?? null);
        $slug = $explicit
            ? (string) $data['slug']
            : CatalogSlug::derive($titleEn ?? $data['title'], fn (string $s) => $this->slugTaken($s, null), 'collection');
        if ($explicit && $this->slugTaken($slug, null)) {
            throw new CommerceTaxonomyConflictException('المعرّف النصي (slug) مستخدم بالفعل.');
        }

        try {
            $collection = CommerceCollection::create([
                'slug' => $slug,
                'title' => trim($data['title']),
                'title_en' => $titleEn,
                'description' => $this->nullableTrim($data['description'] ?? null),
                'status' => $data['status'] ?? CommerceCollection::STATUS_DRAFT,
                'sort_order' => $data['sort_order'] ?? 0,
            ]);
        } catch (QueryException $e) {
            throw $this->uniqueOr($e);
        }

        return $this->present($collection, 0);
    }

    /** @param array<string, mixed> $data */
    public function update(string $id, array $data): ?array
    {
        $collection = CommerceCollection::query()->find($id);
        if ($collection === null) {
            return null;
        }

        $update = [];
        foreach (['title'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = trim((string) $data[$field]);
            }
        }
        foreach (['title_en', 'description'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = $this->nullableTrim($data[$field]);
            }
        }
        foreach (['status', 'sort_order'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = $data[$field];
            }
        }
        if (array_key_exists('slug', $data) && $data['slug'] !== $collection->slug) {
            if ($this->slugTaken((string) $data['slug'], $collection->id)) {
                throw new CommerceTaxonomyConflictException('المعرّف النصي (slug) مستخدم بالفعل.');
            }
            $update['slug'] = $data['slug'];
        }

        try {
            $collection->forceFill($update)->save();
        } catch (QueryException $e) {
            throw $this->uniqueOr($e);
        }

        return $this->present($collection, CommerceCollectionProduct::query()->where('commerce_collection_id', $collection->id)->count());
    }

    public function delete(string $id): ?bool
    {
        $collection = CommerceCollection::query()->find($id);
        if ($collection === null) {
            return null;
        }

        $collection->delete();

        return true;
    }

    /** @return list<array<string, mixed>>|null */
    public function members(string $id): ?array
    {
        $collection = CommerceCollection::query()->find($id);
        if ($collection === null) {
            return null;
        }

        return $this->memberRows($collection);
    }

    /**
     * يستبدل العضوية بقائمة مرتّبة (مثاليّ التكرار). الترتيب = ترتيب المصفوفة.
     *
     * @param  list<string>  $productIds
     * @return list<array<string, mixed>>|null
     */
    public function replaceMembers(string $id, array $productIds): ?array
    {
        $productIds = array_values(array_unique($productIds));
        if (count($productIds) > self::MAX_MEMBERS) {
            throw new DomainException('عدد المنتجات يتجاوز الحد المسموح للمجموعة.');
        }

        return DB::transaction(function () use ($id, $productIds) {
            $collection = CommerceCollection::query()->lockForUpdate()->find($id);
            if ($collection === null) {
                return null;
            }

            $found = Product::query()->whereIn('id', $productIds)->pluck('id')->all();
            if (count($found) !== count($productIds)) {
                throw new DomainException('أحد المنتجات المحددة غير موجود لهذا المستأجر.');
            }

            CommerceCollectionProduct::query()->where('commerce_collection_id', $collection->id)->delete();
            foreach ($productIds as $position => $productId) {
                CommerceCollectionProduct::create([
                    'commerce_collection_id' => $collection->id,
                    'product_id' => $productId,
                    'position' => $position,
                ]);
            }

            return $this->memberRows($collection);
        });
    }

    /** @return list<array<string, mixed>> */
    private function memberRows(CommerceCollection $collection): array
    {
        return CommerceCollectionProduct::query()
            ->where('commerce_collection_id', $collection->id)
            ->with(['product' => fn ($q) => $q->select(['id', 'name', 'name_en', 'sku', 'is_active'])])
            ->orderBy('position')
            ->get()
            ->filter(fn (CommerceCollectionProduct $m) => $m->product !== null)
            ->map(fn (CommerceCollectionProduct $m) => [
                'product_id' => $m->product_id,
                'name' => $m->product->name,
                'name_en' => $m->product->name_en,
                'sku' => $m->product->sku,
                'is_active' => (bool) $m->product->is_active,
                'position' => $m->position,
            ])
            ->values()
            ->all();
    }

    private function present(CommerceCollection $c, int $memberCount): array
    {
        return [
            'id' => $c->id,
            'slug' => $c->slug,
            'title' => $c->title,
            'title_en' => $c->title_en,
            'description' => $c->description,
            'status' => $c->status,
            'sort_order' => $c->sort_order,
            'member_count' => $memberCount,
        ];
    }

    private function slugTaken(string $slug, ?string $exceptId): bool
    {
        return CommerceCollection::query()
            ->where('slug', $slug)
            ->when($exceptId !== null, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();
    }

    private function tenantId(): string
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return $tenantId;
    }

    private function nullableTrim(?string $value): ?string
    {
        $value = $value === null ? null : trim($value);

        return $value === '' ? null : $value;
    }

    private function uniqueOr(QueryException $e): \Throwable
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $driverCode = $e->errorInfo[1] ?? null;
        $isUnique = $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');

        return $isUnique ? new CommerceTaxonomyConflictException('المعرّف النصي (slug) مستخدم بالفعل.') : $e;
    }
}
