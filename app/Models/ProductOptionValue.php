<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * قيمة واحدة لخيار منتج (أسود لخيار اللون، XL لخيار المقاس). تنتمي لخيارٍ
 * واحد، وبالتبعية لمنتجٍ ومستأجرٍ واحد. لا `product_id` مباشر عمداً — الملكية
 * الحقيقية عبر `product_option_id` فقط، فلا مصدرَي حقيقة لنفس العلاقة.
 */
class ProductOptionValue extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_option_id', 'value', 'value_en', 'value_key', 'sort_order', 'is_active',
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

    public function option(): BelongsTo
    {
        return $this->referenceBelongsTo(ProductOption::class, 'product_option_id');
    }

    /** المتغيّرات التي تختار هذه القيمة — للتحقق من الاستعمال قبل الحذف فقط. */
    public function variants(): BelongsToMany
    {
        return $this->belongsToMany(
            ProductVariant::class,
            'product_variant_option_values',
            'product_option_value_id',
            'product_variant_id',
        );
    }
}
