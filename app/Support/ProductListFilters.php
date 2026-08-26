<?php

namespace App\Support;

use App\Models\Product;
use Illuminate\Database\Eloquent\Builder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  عقد تصفية وفرز قائمة المنتجات — مصدر واحد للقائمة وللتصدير
 * ═══════════════════════════════════════════════════════════════
 *  كانت التصفية مكتوبةً داخل `ProductController::index` وحدها، فأيّ تصديرٍ
 *  خادميّ كان سيعيد كتابتها. ونسخةٌ ثانية تعني — حتماً لا احتمالاً — انحرافاً
 *  يظهر يوم يضيف أحدهم مرشّحاً في مكان دون الآخر، فيصدّر المستخدم «نتائج
 *  البحث الحالية» ويجد فيها ما ليس فيها.
 *
 *  الفرق الوحيد المسموح بين المسارين هو التقسيم: القائمة تقسّم، والتصدير
 *  المفلتر لا يقسّم أبداً.
 */
class ProductListFilters
{
    /** أعمدة الفرز المسموحة — مفتاح الواجهة → عمود قاعدة البيانات. */
    public const SORTS = [
        'name' => 'name',
        'sku' => 'sku',
        'sale_price' => 'sale_price',
        'purchase_price' => 'purchase_price',
        'quantity_on_hand' => 'quantity_on_hand',
        'created_at' => 'created_at',
    ];

    /**
     * قواعد التحقق المشتركة (بلا `page`/`per_page` — تخصّان القائمة وحدها).
     *
     * @return array<string, array<int, string>>
     */
    public static function rules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'type' => ['sometimes', 'nullable', 'in:good,service'],
            'is_active' => ['sometimes', 'nullable', 'boolean'],
            'stock_state' => ['sometimes', 'nullable', 'in:tracked,not_tracked,out,low'],
            'sale_price_gte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sale_price_lte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sale_price_eq' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'purchase_price_gte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'purchase_price_lte' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'purchase_price_eq' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
        ];
    }

    /** الاستعلام الأساس (بلا تحميل مسبق — كل مستهلك يعلن ما يحتاجه). */
    public static function query(): Builder
    {
        return Product::query();
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public static function apply(Builder $query, array $filters): Builder
    {
        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(trim((string) $filters['search']), '%_\\');
            $like = "%{$needle}%";
            $query->where(function (Builder $search) use ($like): void {
                $search
                    ->where('name', 'like', $like)
                    ->orWhere('name_en', 'like', $like)
                    ->orWhere('sku', 'like', $like)
                    ->orWhere('barcode', 'like', $like)
                    ->orWhere('category', 'like', $like)
                    ->orWhere('brand', 'like', $like)
                    ->orWhereHas('productCategory', fn ($category) => $category->where('name', 'like', $like))
                    ->orWhereHas('productBrand', fn ($brand) => $brand->where('name', 'like', $like));
            });
        }

        if (filled($filters['category_id'] ?? null)) {
            $query->where('category_id', $filters['category_id']);
        }
        if (filled($filters['type'] ?? null)) {
            $query->where('type', $filters['type']);
        }
        if (array_key_exists('is_active', $filters) && $filters['is_active'] !== null && $filters['is_active'] !== '') {
            $query->where('is_active', filter_var($filters['is_active'], FILTER_VALIDATE_BOOLEAN));
        }

        if (filled($filters['stock_state'] ?? null)) {
            match ($filters['stock_state']) {
                'tracked' => $query->where('track_inventory', true),
                'not_tracked' => $query->where('track_inventory', false),
                'out' => $query->where('track_inventory', true)->where('quantity_on_hand', '<=', 0),
                'low' => $query
                    ->where('track_inventory', true)
                    ->where('quantity_on_hand', '>', 0)
                    ->where('reorder_level', '>', 0)
                    ->whereColumn('quantity_on_hand', '<=', 'reorder_level'),
                default => null,
            };
        }

        foreach (['sale_price', 'purchase_price'] as $column) {
            foreach (['gte' => '>=', 'lte' => '<=', 'eq' => '='] as $suffix => $operator) {
                $key = "{$column}_{$suffix}";
                if (filled($filters[$key] ?? null)) {
                    $query->where($column, $operator, self::moneyFilterToMinor((string) $filters[$key]));
                }
            }
        }

        return $query;
    }

    /**
     * الفرز مع مِرساة حتمية (`id`) — بلا مِرساة يصبح ترتيب القيم المتساوية
     * غير مضمون، فتتكرّر صفوف أو تسقط بين دفعتين في التصدير.
     */
    public static function applySort(Builder $query, ?string $sort, bool $paginated): Builder
    {
        $sort = (string) ($sort ?? '');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $key = ltrim($sort, '-');

        if ($sort !== '' && isset(self::SORTS[$key])) {
            return $query->orderBy(self::SORTS[$key], $direction)->orderByDesc('id');
        }

        if ($paginated) {
            // صفحة المنتجات تاريخياً تبدأ بالاسم؛ نبقي ذلك هو افتراض Data Explorer.
            return $query->orderBy('name')->orderByDesc('id');
        }

        // توافق خلفي مع كل مستهلك قديم لـ GET /products بلا pagination.
        return $query->latest();
    }

    /** «12.5» → 1250 هللة. بلا `float` كي لا يفلت مرشّح سعر من الحافة. */
    public static function moneyFilterToMinor(string $value): int
    {
        $normalized = trim($value);
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        $fraction = substr(str_pad(preg_replace('/\D/', '', $fraction) ?? '', 2, '0'), 0, 2);

        return ((int) preg_replace('/\D/', '', $whole) * 100) + (int) $fraction;
    }
}
