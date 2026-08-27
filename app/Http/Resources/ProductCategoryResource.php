<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductCategoryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'          => $this->id,
            'name'        => $this->name,
            'description' => $this->description,
            'parent_id'   => $this->parent_id,
            'is_active'   => (bool) $this->is_active,
            'image'       => $this->image_path ? [
                'download_url' => "/api/product-categories?image_id={$this->id}",
                'original_name' => $this->image_original_name,
                'mime_type' => $this->image_mime_type,
                'size' => $this->image_size,
            ] : null,
            // عدّ المنتجات يُحمَّل في القائمة وحدها (withCount) — لا استعلام
            // إضافي لكل صفّ، ولا حقلٌ يظهر ثم يختفي حسب المسار.
            'products_count' => $this->whenNotNull($this->products_count),
        ];
    }
}
