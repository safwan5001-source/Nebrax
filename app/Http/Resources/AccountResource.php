<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AccountResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'parent_id'      => $this->parent_id,
            'code'           => $this->code,
            'name'           => $this->name,
            'name_en'        => $this->name_en,
            'type'           => $this->type,
            'normal_balance' => $this->normal_balance,
            'is_group'       => $this->is_group,
            'is_system'      => $this->is_system,
            'is_active'      => $this->is_active,
            'children_count' => $this->whenCounted('children'),
            'has_entries'    => $this->whenCounted('lines', fn () => $this->lines_count > 0),
            'balance'        => Money::toRiyal($this->balance?->balance ?? 0),
        ];
    }
}
