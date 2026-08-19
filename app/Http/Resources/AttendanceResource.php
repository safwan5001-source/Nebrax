<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AttendanceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'              => $this->id,
            'employee_id'     => $this->employee_id,
            'employee'        => $this->whenLoaded('employee', fn () => $this->employee ? [
                'id' => $this->employee->id, 'name' => $this->employee->name,
            ] : null),
            'shift_id'        => $this->shift_id,
            'shift'           => $this->whenLoaded('shift', fn () => $this->shift ? [
                'id' => $this->shift->id, 'name' => $this->shift->name,
            ] : null),
            'attendance_date' => optional($this->attendance_date)->toDateString(),
            'check_in'        => $this->check_in ? substr((string) $this->check_in, 0, 5) : null,
            'check_out'       => $this->check_out ? substr((string) $this->check_out, 0, 5) : null,
            'status'          => $this->status,
            'worked_minutes'  => $this->workedMinutes(), // مشتقّ لا مخزَّن
            'notes'           => $this->notes,
        ];
    }
}
