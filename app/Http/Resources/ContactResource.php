<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ContactResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'partner_id' => $this->partner_id,
            'name'       => $this->name,
            'job_title'  => $this->job_title,
            'email'      => $this->email,
            'phone'      => $this->phone,
            'notes'      => $this->notes,
        ];
    }
}
