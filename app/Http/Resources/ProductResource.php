<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'               => $this->id,
            'sku'              => $this->sku,
            'barcode'          => $this->barcode,
            'name'             => $this->name,
            'name_en'          => $this->name_en,
            'description'      => $this->description,
            // الاسم من العلاقة أولاً، والنصّ القديم احتياطياً لمنتجٍ لم يُربط
            // بعد. فإعادة تسمية التصنيف تسري على كل منتجاته فوراً بلا مزامنة.
            'category'         => $this->productCategory?->name ?? $this->category,
            'brand'            => $this->productBrand?->name ?? $this->brand,
            'category_id'      => $this->category_id,
            'brand_id'         => $this->brand_id,
            'unit_template_id' => $this->unit_template_id,
            // الوحدات المتاحة للسطر: الأساس بمعامل ١ ثم البدائل — تقرؤها شاشات
            // الفاتورة والمشتريات مباشرةً بلا استدعاء ثانٍ.
            // فحصٌ صريح لا `whenNotNull`: تلك تُعيد `MissingValue` وهو **كائن**
            // فيمرّ الشرط الثلاثي دائماً ثم ينفجر على قالب غير موجود.
            'units'            => $this->unitTemplate
                ? collect([['name' => $this->unitTemplate->base_unit, 'factor' => 1]])
                    ->concat($this->unitTemplate->units->map(fn ($u) => ['name' => $u->name, 'factor' => (int) $u->factor]))
                    ->values()
                : [],
            // حقل خاص بكتالوج POS فقط: وحدة الأساس بسعرها ثم البدائل التي
            // تملك سعراً صريحاً في قائمة العميل. لا يظهر في مورد المنتج العام.
            'pos_units'        => $this->when(
                array_key_exists('pos_units', $this->resource->getAttributes()),
                collect($this->resource->getAttribute('pos_units'))->map(fn (array $unit) => [
                    'name' => $unit['name'],
                    'factor' => (int) $unit['factor'],
                    'price' => Money::toRiyal((int) $unit['price']),
                ])->values()
            ),
            // باركودات كتالوج POS المؤقتة مقيدة بوحدات `pos_units` الظاهرة؛
            // لا تتسرب إلى عقد المنتج العام ولا تعرض وحدة غير مسعّرة للعميل.
            'pos_barcodes'     => $this->when(
                array_key_exists('pos_barcodes', $this->resource->getAttributes()),
                collect($this->resource->getAttribute('pos_barcodes'))->map(fn (array $barcode) => [
                    'code' => $barcode['code'],
                    'unit_name' => $barcode['unit_name'],
                    'default_quantity' => (int) $barcode['default_quantity'],
                ])->values()
            ),
            'reorder_level'    => $this->reorder_level,
            'supplier_id'      => $this->supplier_id,
            'sales_account_id' => $this->sales_account_id,
            'cogs_account_id'  => $this->cogs_account_id,
            'min_sale_price'   => $this->min_sale_price !== null ? Money::toRiyal($this->min_sale_price) : null,
            'discount'         => $this->discount,
            'discount_type'    => $this->discount_type,
            'profit_margin'    => $this->profit_margin,
            'tags'             => $this->tags,
            'internal_notes'   => $this->internal_notes,
            'type'             => $this->type,
            'unit'             => $this->unit,
            'sale_price'       => Money::toRiyal($this->sale_price),
            'purchase_price'   => Money::toRiyal($this->purchase_price),
            'tax_rate'         => $this->tax_rate,
            'track_inventory'  => $this->track_inventory,
            'quantity_on_hand' => $this->quantity_on_hand,
            'avg_cost'         => Money::toRiyal($this->avg_cost),
            'is_active'        => $this->is_active,
        ];
    }
}
