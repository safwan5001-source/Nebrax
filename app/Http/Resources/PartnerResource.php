<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PartnerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'code'       => $this->code,
            'type'       => $this->type,
            'name'       => $this->name,
            'name_en'    => $this->name_en,
            'vat_number' => $this->vat_number,
            'cr_number'  => $this->cr_number,
            'email'      => $this->email,
            'phone'      => $this->phone,
            'address'    => $this->address,
            'city'       => $this->city,
            'is_active'  => $this->is_active,
        ];
    }
}
