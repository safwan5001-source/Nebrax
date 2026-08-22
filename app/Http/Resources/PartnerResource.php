<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PartnerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'code'       => $this->code,
            'type'        => $this->type,
            'entity_type' => $this->entity_type,
            'name'       => $this->name,
            'name_en'    => $this->name_en,
            'vat_number' => $this->vat_number,
            'cr_number'  => $this->cr_number,
            'email'      => $this->email,
            'phone'      => $this->phone,
            'mobile'     => $this->mobile,
            'address'    => $this->address,
            'city'       => $this->city,
            'building_no'  => $this->building_no,
            'street'       => $this->street,
            'district'     => $this->district,
            'postal_code'  => $this->postal_code,
            'country'      => $this->country,
            'classification' => $this->classification, // حقل انتقالي للتوافق الرجعي
            'customer_classification_id' => $this->customer_classification_id,
            'supplier_classification_id' => $this->supplier_classification_id,
            'default_price_list_id' => $this->default_price_list_id,
            'default_price_list' => $this->whenLoaded('defaultPriceList', fn () => $this->defaultPriceList ? [
                'id' => $this->defaultPriceList->id,
                'name' => $this->defaultPriceList->name,
                'is_active' => (bool) $this->defaultPriceList->is_active,
            ] : null),
            'customer_classification' => $this->whenLoaded('customerClassification', fn () => [
                'id' => $this->customerClassification?->id,
                'name' => $this->customerClassification?->name,
            ]),
            'supplier_classification' => $this->whenLoaded('supplierClassification', fn () => [
                'id' => $this->supplierClassification?->id,
                'name' => $this->supplierClassification?->name,
            ]),
            'credit_limit'  => $this->credit_limit !== null ? Money::toRiyal($this->credit_limit) : null,
            'credit_period' => $this->credit_period,
            'is_active'  => $this->is_active,
        ];
    }
}
