<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductMediaResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'original_name' => $this->original_name,
            'mime_type' => $this->mime_type,
            'size' => (int) $this->size,
            'sort_order' => (int) $this->sort_order,
            'download_url' => "/api/products/{$this->product_id}/media/{$this->id}/download",
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
