<?php

namespace App\Http\Resources;

use App\Support\PublicMoney;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * تمثيل المنتج في الـ Public API — عقد مُنتقى ومستقر.
 *
 * النقود بالوحدات الصغرى الصحيحة (`sale_price_minor`) + `currency`. يستبعد داخليّات
 * المخزون والمحاسبة: التكلفة (avg_cost)، سعر الشراء، الحدّ الأدنى للسعر، الهامش،
 * حسابات المبيعات/التكلفة، الكمية، مستوى إعادة الطلب، الملاحظات الداخلية، وكتالوج POS.
 */
class PublicProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'              => $this->id,
            'sku'             => $this->sku,
            'barcode'         => $this->barcode,
            'name'            => $this->name,
            'name_en'         => $this->name_en,
            'description'     => $this->description,
            'type'            => $this->type, // good | service
            'unit'            => $this->unit,
            'category'        => $this->productCategory?->name ?? $this->category,
            'brand'           => $this->productBrand?->name ?? $this->brand,
            'currency'        => PublicMoney::currency($request),
            'sale_price_minor' => PublicMoney::minor($this->sale_price),
            'tax_rate'        => (int) $this->tax_rate,
            'track_inventory' => (bool) $this->track_inventory,
            'is_active'       => (bool) $this->is_active,
            'created_at'      => $this->created_at?->toIso8601String(),
            'updated_at'      => $this->updated_at?->toIso8601String(),
        ];
    }
}
