<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * تمثيل إعداد بوابة الدفع. لا يكشف secret_key أو webhook_secret أو extra_credentials.
 */
class PaymentGatewayResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'provider' => $this->provider,
            'name' => $this->name,
            'name_en' => $this->name_en,
            'environment' => $this->environment,
            'is_active' => (bool) $this->is_active,
            'merchant_reference' => $this->merchant_reference,
            'publishable_key' => $this->publishable_key,
            'payment_method_id' => $this->payment_method_id,
            'has_secret_key' => $this->hasSecretKey(),
            'has_webhook_secret' => $this->hasWebhookSecret(),
            'has_extra_credentials' => $this->hasExtraCredentials(),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
