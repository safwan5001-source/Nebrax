<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * تركيبة محدَّدة من قيم خيارات منتجٍ ما (مثلاً: أسود + XL). هويةٌ قابلة للبيع
 * مستقلّة فقط لمنتجٍ في حالة `variant_managed` — لا تحمل أي دلالة وحدة قياس.
 *
 * `combination_key` تمثيلٌ خادميّ حتميّ (معرّفات القيم مرتّبة أبجدياً ومفصولة
 * بفاصلة) — لا يُعتَمد أبداً على مفتاحٍ يرسله العميل. القيد الفريد
 * `(product_id, combination_key)` في قاعدة البيانات هو الضامن الحقيقي لمنع
 * ازدواج التركيبة تحت التزامن، لا فحص الخدمة وحده.
 */
class ProductVariant extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'sku', 'combination_key', 'is_active', 'created_by',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    /**
     * جزء من فضاء SKU الموحّد (VAR-CORE-1) — بنفس منطق `Product::booted()`
     * لباركوده تماماً. `saved` لا `saving`: يحتاج `id` نهائياً بعد الإدراج.
     */
    protected static function booted(): void
    {
        static::saved(function (ProductVariant $variant) {
            if (! $variant->isDirty('sku')) {
                return;
            }

            $old = $variant->getOriginal('sku');
            $new = $variant->sku;

            if ($old !== null && $old !== '') {
                SkuRegistryEntry::release($old);
            }
            if ($new !== null && $new !== '') {
                SkuRegistryEntry::claim($new, 'variant', variantId: $variant->id);
            }
        });
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    /** هويّة مخزون هذا المتغيّر بعينه (VAR-INV-1) — قد تكون غائبة إن لم تُستعمل بعد. */
    public function inventoryState(): HasOne
    {
        return $this->hasOne(InventoryState::class, 'product_variant_id');
    }

    /** بلا عمودٍ فيزيائي على هذا الجدول أبداً — `InventoryState` سلطتها الوحيدة منذ الإنشاء. */
    protected function quantityOnHand(): Attribute
    {
        return Attribute::make(get: fn () => (int) ($this->inventoryState?->quantity_on_hand ?? 0));
    }

    protected function avgCost(): Attribute
    {
        return Attribute::make(get: fn () => (int) ($this->inventoryState?->avg_cost ?? 0));
    }

    public function optionValues(): BelongsToMany
    {
        return $this->belongsToMany(
            ProductOptionValue::class,
            'product_variant_option_values',
            'product_variant_id',
            'product_option_value_id',
        )->withPivot('product_option_id')->orderBy('product_option_values.sort_order');
    }
}
