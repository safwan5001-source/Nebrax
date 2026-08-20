<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LeaveRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                => $this->id,
            'employee_id'       => $this->employee_id,
            'employee'          => $this->whenLoaded('employee', fn () => $this->employee ? [
                'id' => $this->employee->id, 'name' => $this->employee->name,
            ] : null),
            'leave_type_id'     => $this->leave_type_id,
            'leave_type'        => $this->whenLoaded('leaveType', fn () => $this->leaveType ? [
                'id' => $this->leaveType->id, 'name' => $this->leaveType->name, 'is_paid' => $this->leaveType->is_paid,
            ] : null),
            'start_date'        => optional($this->start_date)->toDateString(),
            'end_date'          => optional($this->end_date)->toDateString(),
            'days_count'        => $this->days_count,
            'status'            => $this->status,
            'reason'            => $this->reason,
            'rejection_reason'  => $this->rejection_reason,
            'approved_by'       => $this->approved_by,
            'approver'          => $this->whenLoaded('approver', fn () => $this->approver ? [
                'id' => $this->approver->id, 'name' => $this->approver->name,
            ] : null),
            'approved_at'       => optional($this->approved_at)->toIso8601String(),
            'created_at'        => optional($this->created_at)->toIso8601String(),
        ];
    }
}
