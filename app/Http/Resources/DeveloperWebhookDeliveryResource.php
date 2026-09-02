<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * تمثيل تسليم Webhook للقراءة في سطح إدارة المطوّرين الداخلي (PR-7.5) — **بيانات
 * تشغيلية آمنة فقط**. يُعرَض معرّف الحدث/الاشتراك ونوع الحدث ووجهة الاشتراك (ملك
 * المستأجر) والحالة والمحاولات ورمز HTTP وتصنيف الخطأ والتوقيتات.
 *
 * **لا يُعرَض قطّ:** السرّ، مقتطف جسم الاستجابة المخزَّن (`last_response_snippet`)،
 * إيجار المطالبة الداخلي، ولا حمولة الحدث — تفاديًا لتسريب بيانات فواتير/محاسبة أو
 * أي محتوى حسّاس (§19/§21).
 */
class DeveloperWebhookDeliveryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'              => $this->id,
            'event_id'        => $this->webhook_event_id,
            'endpoint_id'     => $this->webhook_endpoint_id,
            'event_type'      => $this->whenLoaded('event', fn () => $this->event?->type),
            'endpoint_url'    => $this->whenLoaded('endpoint', fn () => $this->endpoint?->url),
            'status'          => $this->status,
            'attempts'        => (int) $this->attempts,
            'http_status'     => $this->last_status_code,
            'error'           => $this->last_error, // تصنيف مختصر (مثل http_500/timeout)
            'duration_ms'     => $this->last_duration_ms,
            'next_attempt_at' => $this->next_attempt_at?->toIso8601String(),
            'delivered_at'    => $this->delivered_at?->toIso8601String(),
            'failed_at'       => $this->failed_at?->toIso8601String(),
            'created_at'      => $this->created_at?->toIso8601String(),
        ];
    }
}
