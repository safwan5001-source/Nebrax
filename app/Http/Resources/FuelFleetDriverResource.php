<?php

namespace App\Http\Resources;

use App\Support\Rbac;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * FS-35: قائمة حقول صريحة بدل النموذج الخام. الجوال وربط الموظف لا يظهران إلا لمن يدير الأسطول
 * (`fuel.fleet.manage`)؛ ولا يخرج `tenant_id` ولا `created_by`. `identifier` يبقى (تستعمله شاشة AVI لتمييز السائق).
 */
class FuelFleetDriverResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $manager = $user !== null && Rbac::allows((string) $user->role, 'fuel.fleet.manage');

        return [
            'id' => $this->id,
            'partner_id' => $this->partner_id,
            'corporate_fuel_contract_id' => $this->corporate_fuel_contract_id,
            'name' => $this->name,
            'identifier' => $this->identifier,
            'status' => $this->status,
            'mobile' => $this->when($manager, fn () => $this->mobile),
            'employee_id' => $this->when($manager, fn () => $this->employee_id),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
