<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BranchResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'            => $this->id,
            'code'          => $this->code,
            'name'          => $this->name,
            'is_main'       => (bool) $this->is_main,
            'phone'         => $this->phone,
            'mobile'        => $this->mobile,
            'address_line1' => $this->address_line1,
            'address_line2' => $this->address_line2,
            'city'          => $this->city,
            'region'        => $this->region,
            'country'       => $this->country,
            'description'   => $this->description,
            'working_hours' => $this->working_hours,
            'latitude'      => $this->latitude !== null ? (float) $this->latitude : null,
            'longitude'     => $this->longitude !== null ? (float) $this->longitude : null,
            'is_active'     => (bool) $this->is_active,
        ];
    }
}
