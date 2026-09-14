<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * بُعد متغيّر واحد لمنتج (اللون، المقاس، ...). مملوكٌ بالكامل للمنتج —
 * `CompanyWide` كـ`ProductBarcode`/`ProductMedia` حرفياً: لا مفهوم فرعٍ خاصٍّ
 * به، وعزل ظهوره يتبع عزل المنتج المالك عبر `referenceBelongsTo`.
 *
 * الهوية المنطقية (لمنع التكرار) مبنيّة على `name_key` (تطبيع lower/trim) لا
 * `name` الظاهر — فتغيير حالة الأحرف أو المسافات لا يخلق خياراً مكرَّراً.
 */
class ProductOption extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'name', 'name_en', 'name_key', 'sort_order', 'is_active',
    ];

    protected $casts = [
        'sort_order' => 'integer',
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'sort_order' => 0,
        'is_active' => true,
    ];

    public static function normalizeKey(string $value): string
    {
        return mb_strtolower(trim($value));
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function values(): HasMany
    {
        return $this->hasMany(ProductOptionValue::class)->orderBy('sort_order');
    }
}
