<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AccountWorkspaceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                 => $this->id,
            'parent_id'          => $this->parent_id,
            'code'               => $this->code,
            'name'               => $this->name,
            'name_en'            => $this->name_en,
            'type'               => $this->type,
            'normal_balance'     => $this->normal_balance,
            'is_group'           => $this->is_group,
            'is_system'          => $this->is_system,
            'is_active'          => $this->is_active,
            'children_count'     => (int) ($this->workspace_children_count ?? 0),
            'has_entries'        => (bool) ($this->workspace_has_entries ?? false),
            // الرصيد المباشر والتجميعي مشتقان من journal_lines بحسب نطاق الفرع.
            // لا يُعاد استخدام AccountBalance هنا، لأنه لقطة مجمعة للمؤسسة كلها.
            'direct_balance'     => Money::toRiyal((int) ($this->workspace_direct_balance ?? 0)),
            'aggregated_balance' => Money::toRiyal((int) ($this->workspace_aggregated_balance ?? 0)),
            'balance'            => Money::toRiyal((int) ($this->workspace_balance ?? 0)),
            'path'               => $this->workspace_path ?? [],
        ];
    }
}
