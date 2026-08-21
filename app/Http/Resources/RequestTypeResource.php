<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RequestTypeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                    => $this->id,
            'name'                  => $this->name,
            'requires_approval'     => $this->requires_approval,
            'is_active'             => $this->is_active,
            'employee_requests_count' => $this->whenCounted('employeeRequests'),
        ];
    }
}
