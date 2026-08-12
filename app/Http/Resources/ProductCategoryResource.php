<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductCategoryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'            => $this->id,
            'name'          => $this->name,
            'parent_id'     => $this->parent_id,
            'is_active'     => (bool) $this->is_active,
            // عدّ المنتجات يُحمَّل في القائمة وحدها (withCount) — لا استعلام
            // إضافي لكل صفّ، ولا حقلٌ يظهر ثم يختفي حسب المسار.
            'products_count' => $this->whenNotNull($this->products_count),
        ];
    }
}
