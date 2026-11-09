<?php

namespace App\Http\Resources;

use App\Support\Rbac;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** TANKER-PR1: ربط شركة بصاحب صهريج. `is_active` مشتق من التواريخ وقت القراءة (لا عمود مخزَّن)؛ الملاحظة وسبب الإنهاء للمدير فقط. */
class FuelTankerOwnerLinkResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $manager = $user !== null && Rbac::allows((string) $user->role, 'fuel.tanker.manage');
        $today = now()->toDateString();
        $from = $this->valid_from?->toDateString();
        $to = $this->valid_to?->toDateString();

        return [
            'id' => $this->id,
            'fuel_tanker_owner_id' => $this->fuel_tanker_owner_id,
            'partner_id' => $this->partner_id,
            'partner' => $this->whenLoaded('partner', fn () => $this->partner === null ? null : ['id' => $this->partner->id, 'name' => $this->partner->name]),
            'valid_from' => $from,
            'valid_to' => $to,
            'is_active' => $from !== null && $from <= $today && ($to === null || $to >= $today),
            'note' => $this->when($manager, fn () => $this->note),
            'end_reason' => $this->when($manager, fn () => $this->end_reason),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
