<?php

namespace App\Http\Resources;

use App\Support\SensitiveCostPolicy;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductActivityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'action'     => $this->action,
            // PR-INV-1: diff خام كان يكشف سعر الشراء/هامش الربح (قديماً وجديداً)
            // لمن لا يملك `products.view_cost`. الحذف يشمل المفتاح كاملاً لا قيمته
            // فقط — فلا يُستدَلّ حتى على وقوع تغيير في حقل حسّاس بعينه.
            'diff'       => SensitiveCostPolicy::redactActivityDiff(
                (array) $this->diff,
                SensitiveCostPolicy::authorized($request->user())
            ),
            'created_at' => $this->created_at?->toISOString(),
            'user'       => $this->whenLoaded('user', fn () => $this->user ? [
                'id'   => $this->user->id,
                'name' => $this->user->name,
            ] : null),
        ];
    }
}
