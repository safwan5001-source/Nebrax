<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentRevisionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'action'     => $this->action,
            // القيم كما تُخزَّن (هللات للمال) — التحويل إلى ريال في طبقة العرض.
            'changes'    => $this->diff,
            'user_id'    => $this->user_id,
            'user_name'  => $this->whenLoaded('user', fn () => $this->user?->name),
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
