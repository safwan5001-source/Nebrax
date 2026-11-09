<?php

namespace App\Http\Resources;

use App\Support\Rbac;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** TANKER-PR1: الصهريج. السعة بالمللتر عدد صحيح؛ الملاحظات للمدير فقط؛ لا `plate_key` ولا `tenant_id`. */
class FuelTankerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $manager = $user !== null && Rbac::allows((string) $user->role, 'fuel.tanker.manage');

        return [
            'id' => $this->id,
            'fuel_tanker_owner_id' => $this->fuel_tanker_owner_id,
            'plate_number' => $this->plate_number,
            'plate_country' => $this->plate_country,
            'capacity_milliliters' => $this->capacity_milliliters,
            'status' => $this->status,
            'notes' => $this->when($manager, fn () => $this->notes),
            'owner' => $this->whenLoaded('owner', fn () => ['id' => $this->owner->id, 'name' => $this->owner->name, 'code' => $this->owner->code]),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
