<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * لا تكشف `dedupe_key` ولا `recipient_id` ولا أي حقل داخلي — واجهة العرض
 * الآمنة فقط. `source_id`/`action` تُعرض لأن فتحها يُعاد تفويضه من جديد في
 * وحدة المصدر، لا أن هذا العرض يمنح وصولاً.
 */
class NotificationResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'category' => $this->category,
            'type' => $this->type,
            'severity' => $this->severity,
            'title' => $this->title,
            'message' => $this->message,
            'source_type' => $this->source_type,
            'source_id' => $this->source_id,
            'action' => $this->action,
            'data' => $this->data,
            'read_at' => $this->read_at?->toISOString(),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
