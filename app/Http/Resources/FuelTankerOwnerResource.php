<?php

namespace App\Http\Resources;

use App\Support\Rbac;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * TANKER-PR1: قائمة حقول صريحة. الهاتف والملاحظات لا تظهر إلا لمن يدير (`fuel.tanker.manage`)؛ ولا يخرج `tenant_id` ولا `created_by` ولا `partner_id`.
 */
class FuelTankerOwnerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $manager = $user !== null && Rbac::allows((string) $user->role, 'fuel.tanker.manage');

        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'status' => $this->status,
            'phone' => $this->when($manager, fn () => $this->phone),
            'notes' => $this->when($manager, fn () => $this->notes),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
