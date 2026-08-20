<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LeaveTypeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                    => $this->id,
            'name'                  => $this->name,
            'is_paid'               => $this->is_paid,
            'annual_days'           => $this->annual_days,
            'requires_approval'     => $this->requires_approval,
            'is_active'             => $this->is_active,
            'leave_requests_count'  => $this->whenCounted('leaveRequests'),
        ];
    }
}
