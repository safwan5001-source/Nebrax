<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * TANKER-PR5: مرفق سند تعبئة. يربط كل مرفق بالسند الإلكتروني (`fill_number` FTF) والورقي (`voucher_number`). لا `disk` ولا `path` ولا `sha256` ولا `tenant_id`
 * (المسار الداخلي لا يُكشف أبداً؛ التنزيل عبر مسار مصرَّح به). `$fill` يُمرَّر عبر `additional` أو علاقة محمَّلة.
 */
class FuelTankerFillAttachmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $fill = $this->relationLoaded('tankerFill') ? $this->tankerFill : null;

        return [
            'id' => $this->id,
            'fuel_tanker_fill_id' => $this->fuel_tanker_fill_id,
            'fill_number' => $fill?->number,
            'voucher_number' => $fill?->voucher_number,
            'original_name' => $this->original_name,
            'mime_type' => $this->mime_type,
            'kind' => $this->isImage() ? 'image' : 'pdf',
            'size' => $this->size,
            'status' => $this->status,
            'uploaded_by' => $this->uploaded_by,
            'uploaded_by_name' => $this->whenLoaded('uploader', fn () => $this->uploader?->name),
            'uploaded_at' => $this->uploaded_at?->toIso8601String(),
            'replaces_attachment_id' => $this->replaces_attachment_id,
            'replaced_by_attachment_id' => $this->replaced_by_attachment_id,
            'removed_by' => $this->removed_by,
            'removed_by_name' => $this->whenLoaded('remover', fn () => $this->remover?->name),
            'removed_at' => $this->removed_at?->toIso8601String(),
            'removal_reason' => $this->removal_reason,
        ];
    }
}
