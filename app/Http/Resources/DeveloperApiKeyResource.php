<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * تمثيل بيانات مفتاح Public API الآمنة (PR-7.5) — من صفّ توكن Sanctum. **لا يكشف
 * قطّ** التجزئة المخزَّنة (`token`) ولا النصّ الصريح؛ فقط بيانات وصفية آمنة يحتاجها
 * سطح الإدارة الداخلي. النصّ الصريح يُعرَض **مرّة واحدة** خارج هذا المورد عند الإصدار.
 */
class DeveloperApiKeyResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'name'         => $this->name,
            'scopes'       => (array) $this->abilities,
            'last_used_at' => $this->last_used_at?->toIso8601String(),
            'expires_at'   => $this->expires_at?->toIso8601String(),
            'created_at'   => $this->created_at?->toIso8601String(),
        ];
    }
}
