<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class EmployeeRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'               => $this->id,
            'employee_id'      => $this->employee_id,
            'employee'         => $this->whenLoaded('employee', fn () => $this->employee ? [
                'id' => $this->employee->id, 'name' => $this->employee->name,
            ] : null),
            'request_type_id'  => $this->request_type_id,
            'request_type'     => $this->whenLoaded('requestType', fn () => $this->requestType ? [
                'id' => $this->requestType->id, 'name' => $this->requestType->name,
            ] : null),
            'title'            => $this->title,
            'description'      => $this->description,
            'requested_date'   => optional($this->requested_date)->toDateString(),
            'status'           => $this->status,
            'rejection_reason' => $this->rejection_reason,
            'approved_by'      => $this->approved_by,
            'approver'         => $this->whenLoaded('approver', fn () => $this->approver ? [
                'id' => $this->approver->id, 'name' => $this->approver->name,
            ] : null),
            'approved_at'      => optional($this->approved_at)->toIso8601String(),
            'created_at'       => optional($this->created_at)->toIso8601String(),
        ];
    }
}
