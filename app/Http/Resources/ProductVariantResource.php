<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductVariantResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'product_id' => $this->product_id,
            'sku' => $this->sku,
            'combination_key' => $this->combination_key,
            'is_active' => $this->is_active,
            'display_name' => $this->whenLoaded('optionValues', fn () => $this->optionValues
                ->map(fn ($v) => $v->value)
                ->implode(' / ')),
            'option_values' => $this->whenLoaded('optionValues', fn () => $this->optionValues->map(fn ($v) => [
                'option_id' => $v->product_option_id,
                'option_name' => $v->option?->name,
                'value_id' => $v->id,
                'value' => $v->value,
                'value_en' => $v->value_en,
                // VAR-OPTION-VISUAL-1 — القيمة تبقى المالك الوحيد لصريّتها؛
                // هذا نقلٌ للقراءة فقط، لا نسخةٌ مستقلّة تُحدَّث بمعزلٍ عنها.
                'visual_type' => $v->visual_type,
                'color_value' => $v->color_value,
            ])),
            'created_at' => $this->created_at,
        ];
    }
}
