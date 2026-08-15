<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'          => $this->id,
            'name'        => $this->name,
            'email'       => $this->email,
            'role'        => $this->role,
            'is_active'   => $this->is_active,
            // الموظف المرتبط (إن وُجد) — اسمه ورقمه لعرض الربط دون نداء ثانٍ.
            'employee_id' => $this->employee_id,
            'employee'    => $this->whenLoaded('employee', fn () => $this->employee ? [
                'id'          => $this->employee->id,
                'name'        => $this->employee->name,
                'employee_no' => $this->employee->employee_no,
            ] : null),
        ];
    }
}
