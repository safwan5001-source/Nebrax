<?php

namespace App\Http\Resources;

use App\Support\Money;
use App\Support\SensitiveCostPolicy;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // PR-2S: كتالوج POS (`PosController::products()`) يحسب علامة أدقّ (صلاحية
        // **وإعداد** `show_cost_profit_in_pos` معاً) ويضعها صراحة على المورد؛ حين
        // توجد نأخذها كما هي. أي استهلاك آخر (شاشات ERP، الويبهوك، محطات الوقود)
        // لا يضعها، فنسقط PR-INV-1 على السياسة المركزية نفسها التي يقيس عليها POS —
        // لا كشفاً افتراضياً كما كان قبل هذا التاريخ.
        $hidesCostProfit = array_key_exists('pos_hides_cost_profit', $this->resource->getAttributes())
            ? (bool) $this->resource->getAttribute('pos_hides_cost_profit')
            : ! SensitiveCostPolicy::authorized($request->user());

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
            'category_image'   => $this->when(
                $this->relationLoaded('productCategory'),
                fn () => $this->productCategory?->image_path ? [
                    'download_url' => "/api/product-categories?image_id={$this->productCategory->id}",
                ] : null,
            ),
            // PR-2C: لون تعريفي للتصنيف — عرضٌ بحت يستهلكه POS فقط حين يختار
            // المستأجر صراحةً وضع «لون» (`category_presentation_mode`). القيمة
            // مصدرها `ProductCategory::COLOR_REGEX` وحده، فلا حاجة لتصفيةٍ هنا.
            'category_color'   => $this->when(
                $this->relationLoaded('productCategory'),
                fn () => $this->productCategory?->color,
            ),
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
            // كتالوج POS يطلب الوسائط صراحةً، فتصل أول صورة حقيقية فقط كرابط
            // تحميل مصادق عليه. لا يظهر الحقل في مورد المنتج العام دون eager load.
            'pos_image' => $this->whenLoaded('media', function () {
                $media = $this->media->first(fn ($item) => str_starts_with((string) $item->mime_type, 'image/'));

                return $media ? [
                    'download_url' => "/api/products/{$this->id}/media/{$media->id}/download",
                ] : null;
            }),
            'reorder_level'    => $this->reorder_level,
            'supplier_id'      => $this->supplier_id,
            'sales_account_id' => $this->sales_account_id,
            'cogs_account_id'  => $this->cogs_account_id,
            'min_sale_price'   => $this->min_sale_price !== null ? Money::toRiyal($this->min_sale_price) : null,
            'discount'         => $this->discount,
            'discount_type'    => $this->discount_type,
            'profit_margin'    => $this->when(! $hidesCostProfit, $this->profit_margin),
            'tags'             => $this->tags,
            'internal_notes'   => $this->internal_notes,
            'type'             => $this->type,
            'unit'             => $this->unit,
            'sale_price'       => Money::toRiyal($this->sale_price),
            'purchase_price'   => $this->when(! $hidesCostProfit, fn () => Money::toRiyal($this->purchase_price)),
            'tax_rate'         => $this->tax_rate,
            'track_inventory'  => $this->track_inventory,
            'quantity_on_hand' => $this->quantity_on_hand,
            'avg_cost'         => $this->when(! $hidesCostProfit, fn () => Money::toRiyal($this->avg_cost)),
            'is_active'        => $this->is_active,
        ];
    }
}
