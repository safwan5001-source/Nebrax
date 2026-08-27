<?php

namespace App\Support;

use App\Models\Product;
use Illuminate\Database\Eloquent\Builder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  عقد تصفية وفرز أرصدة المخزون — مصدر واحد للشاشة وللتصدير
 * ═══════════════════════════════════════════════════════════════
 *  شاشة `/inventory` تفلتر وتفرز **في المتصفح**: تحمّل كل الأصناف مرّةً
 *  وتقسّمها عرضاً. فتصديرٌ يُبنى من صفوف المتصفح كان يصدّر الصفحة المرئية
 *  ويسمّيها «كل النتائج» — العلّة نفسها التي عولجت في تصدير المنتجات.
 *
 *  هذا العقد يعيد بناء **منطق الشاشة حرفياً** على الخادم، فيصدّر التصدير كل
 *  المطابق لا الصفحة. وأيّ انحراف بين ما تعرضه الشاشة وما يصدّر يعني خطأً في
 *  مطابقة هذا الملف لمنطق `inventory/page.tsx` — لا سلوكين مقصودين.
 *
 *  **المصدر منتجٌ عالميّ لا لكل مخزن:** الرصيد ومتوسط التكلفة حقلان على
 *  `products`، ولا بُعد مخزن ولا فرع على هذا التقرير — كما هو حال الشاشة.
 */
class InventoryBalanceFilters
{
    /** أعمدة الفرز المسموحة — مفتاح الواجهة → تعبير قاعدة البيانات. */
    public const SORTS = [
        'name'             => 'name',
        'sku'              => 'sku',
        'unit'             => 'unit',
        'quantity_on_hand' => 'quantity_on_hand',
        'avg_cost'         => 'avg_cost',
        // قيمة المخزون مشتقّة: تُفرَز بتعبيرها لا بعمود مخزَّن.
        'stock_value'      => 'quantity_on_hand * avg_cost',
    ];

    /**
     * قواعد التحقق المشتركة (بلا `page`/`per_page` — تخصّان الشاشة وحدها).
     *
     * @return array<string, array<int, string>>
     */
    public static function rules(): array
    {
        return [
            'search'           => ['sometimes', 'nullable', 'string', 'max:120'],
            'unit'             => ['sometimes', 'nullable', 'string', 'max:60'],
            'qty_min'          => ['sometimes', 'nullable', 'numeric'],
            'qty_max'          => ['sometimes', 'nullable', 'numeric'],
            'avg_cost_min'     => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'avg_cost_max'     => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'stock_value_min'  => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'stock_value_max'  => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sort'             => ['sometimes', 'nullable', 'string', 'max:40'],
        ];
    }

    /** الاستعلام الأساس: الأصناف المتتبَّعة وحدها — نطاق الشاشة نفسه. */
    public static function query(): Builder
    {
        return Product::query()->where('track_inventory', true);
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    public static function apply(Builder $query, array $filters): Builder
    {
        // البحث على الحقول الثلاثة التي تبحث فيها الشاشة: الرمز والاسم والوحدة.
        // إضافة حقلٍ رابع هنا كانت ستجعل التصدير يطابق ما لا تعرضه الشاشة.
        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(trim((string) $filters['search']), '%_\\');
            $like = "%{$needle}%";
            $query->where(function (Builder $search) use ($like): void {
                $search->where('sku', 'like', $like)
                    ->orWhere('name', 'like', $like)
                    ->orWhere('unit', 'like', $like);
            });
        }

        if (filled($filters['unit'] ?? null)) {
            $query->where('unit', $filters['unit']);
        }

        if (filled($filters['qty_min'] ?? null)) {
            $query->where('quantity_on_hand', '>=', (int) $filters['qty_min']);
        }
        if (filled($filters['qty_max'] ?? null)) {
            $query->where('quantity_on_hand', '<=', (int) $filters['qty_max']);
        }

        // المدى المالي: قيمة الفلتر بالريال، والمقارنة بالهللات — كما تفعل
        // الشاشة حين تقارن `Number(item.avg_cost)` وهو ريال معروض.
        if (filled($filters['avg_cost_min'] ?? null)) {
            $query->where('avg_cost', '>=', self::moneyToMinor((string) $filters['avg_cost_min']));
        }
        if (filled($filters['avg_cost_max'] ?? null)) {
            $query->where('avg_cost', '<=', self::moneyToMinor((string) $filters['avg_cost_max']));
        }

        // قيمة المخزون = الكمية × متوسط التكلفة (بالهللات). تعبيرٌ حسابيّ لا عمود.
        if (filled($filters['stock_value_min'] ?? null)) {
            $query->whereRaw('quantity_on_hand * avg_cost >= ?', [self::moneyToMinor((string) $filters['stock_value_min'])]);
        }
        if (filled($filters['stock_value_max'] ?? null)) {
            $query->whereRaw('quantity_on_hand * avg_cost <= ?', [self::moneyToMinor((string) $filters['stock_value_max'])]);
        }

        return $query;
    }

    /**
     * الفرز مع مِرساة حتمية (`id`): بلا مِرساة يصبح ترتيب القيم المتساوية غير
     * مضمون فتتكرّر صفوف أو تسقط بين دفعتين في التصدير المقسَّم بالإزاحة.
     */
    public static function applySort(Builder $query, ?string $sort): Builder
    {
        $sort = (string) ($sort ?? '');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $key = ltrim($sort, '-');

        $expression = self::SORTS[$key] ?? self::SORTS['name'];

        // تعبير قيمة المخزون يُفرَز بـ`orderByRaw`؛ الأعمدة العادية بـ`orderBy`.
        if ($key === 'stock_value') {
            return $query->orderByRaw("{$expression} {$direction}")->orderByDesc('id');
        }

        return $query->orderBy($expression, $direction)->orderByDesc('id');
    }

    /** «12.5» → 1250 هللة. بلا `float` كي لا يفلت مرشّح من الحافة. */
    public static function moneyToMinor(string $value): int
    {
        $normalized = trim($value);
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        $fraction = substr(str_pad(preg_replace('/\D/', '', $fraction) ?? '', 2, '0'), 0, 2);

        return ((int) preg_replace('/\D/', '', $whole) * 100) + (int) $fraction;
    }
}
