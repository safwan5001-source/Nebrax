<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * عرض آمن لتحديث النظام (PR-NOTIF-6).
 *
 * يُرجع الحقول ثنائية اللغة والاستهداف. لا يكشف بيانات داخلية
 * حسّاسة (مثل author_id للاستخدام العام).
 */
class SystemUpdateResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'target_type' => $this->target_type,
            'title_ar' => $this->title_ar,
            'title_en' => $this->title_en,
            'content_ar' => $this->content_ar,
            'content_en' => $this->content_en,
            'published_at' => $this->published_at?->toISOString(),
            'created_at' => $this->created_at?->toISOString(),
            'targets' => $this->whenLoaded('targets', fn () => $this->targets->map(fn ($t) => [
                'target_type' => $t->target_type,
                'target_id' => $t->target_id,
            ])),
        ];
    }
}
