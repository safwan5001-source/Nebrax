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
            // نطاق الوصول — **مصفوفة فارغة تعني «كل الفروع/المستودعات»** لا الحرمان.
            'branch_ids'    => $this->whenLoaded('branches', fn () => $this->branches->pluck('id')),
            'warehouse_ids' => $this->whenLoaded('warehouses', fn () => $this->warehouses->pluck('id')),
            'employee'    => $this->whenLoaded('employee', fn () => $this->employee ? [
                'id'          => $this->employee->id,
                'name'        => $this->employee->name,
                'employee_no' => $this->employee->employee_no,
            ] : null),
        ];
    }
}
