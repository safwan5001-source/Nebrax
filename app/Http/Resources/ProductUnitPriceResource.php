<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * سعرٌ أساسيّ صريح لهويّةٍ (منتجٌ أو متغيّرٌ فعلي) × وحدة — VAR-PRICE-1
 * (`ProductUnitPrice`). سلطة القراءة الوحيدة لواجهة «باركود متعدد» (VAR-PRICE-UX-1)
 * كي تعكس نفس السعر القانوني عبر كل باركودات (هويّة×وحدة) واحدة.
 */
class ProductUnitPriceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'product_variant_id' => $this->product_variant_id,
            'unit_name' => $this->unit_name,
            'price' => Money::toRiyal((int) $this->price),
        ];
    }
}
