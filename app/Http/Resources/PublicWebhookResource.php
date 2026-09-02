<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * تمثيل اشتراك Webhook في الـ Public API — عقد مُنتقى ومستقر. **لا يكشف السرّ**
 * أبدًا (يُعرَض السرّ الخام مرّة واحدة عند الإنشاء/التدوير فقط، خارج هذا المورد)؛
 * يُعرَض `secret_prefix` غير السرّي للتمييز البشري. لا داخليّات تسليم/تدقيق هنا.
 */
class PublicWebhookResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'              => $this->id,
            'api_client_id'   => $this->api_client_id,
            'url'             => $this->url,
            'description'     => $this->description,
            'event_types'     => (array) $this->event_types,
            'status'          => $this->status,          // enabled | disabled
            'secret_prefix'   => $this->secret_prefix,   // غير سرّي — للتمييز فقط
            'disabled_at'     => $this->disabled_at?->toIso8601String(),
            'last_success_at' => $this->last_success_at?->toIso8601String(),
            'last_failure_at' => $this->last_failure_at?->toIso8601String(),
            'created_at'      => $this->created_at?->toIso8601String(),
            'updated_at'      => $this->updated_at?->toIso8601String(),
        ];
    }
}
