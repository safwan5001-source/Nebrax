<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RoleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'          => $this->id,
            'slug'        => $this->slug,
            'name'        => $this->name,
            'permissions' => $this->permissions ?? [],
            'is_system'   => (bool) $this->is_system,
            // المالك محميّ من التعديل والحذف؛ النظامي محميّ من الحذف — إشارتان
            // للواجهة كي تُعطّل الأزرار بدل أن تصطدم بـ422.
            'is_owner'    => $this->slug === 'owner',
            'users_count' => (int) ($this->users_count ?? 0),
        ];
    }
}
