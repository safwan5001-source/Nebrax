<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ClassificationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'scope' => $this->scope,
            'name' => $this->name,
            'description' => $this->description,
            'is_active' => $this->is_active,
            'customer_partners_count' => $this->whenCounted('customerPartners'),
            'supplier_partners_count' => $this->whenCounted('supplierPartners'),
            'invoices_count' => $this->whenCounted('invoices'),
            'purchases_count' => $this->whenCounted('purchases'),
            'payments_count' => $this->whenCounted('payments'),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
