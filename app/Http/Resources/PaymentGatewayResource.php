<?php

namespace App\Http\Resources;

use App\Support\Rbac;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * تمثيل اتصال بوابة الدفع. لا يكشف secret_key أو webhook_secret أو extra_credentials
 * ولا السر السابق؛ يكشف فقط وجودها وإصدار بيانات الاعتماد ونهاية نافذة السماح.
 * `webhook_key` (معرّف مسار الاستقبال، غير سرّي لكنه هوية) لحامل `payment_gateways.manage` فقط.
 */
class PaymentGatewayResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canManage = $user !== null && Rbac::allows((string) $user->role, 'payment_gateways.manage');

        return [
            'id' => $this->id,
            'provider' => $this->provider,
            'name' => $this->name,
            'name_en' => $this->name_en,
            'environment' => $this->environment,
            'connection_mode' => $this->connection_mode,
            'status' => $this->status,
            'fee_tax_policy' => $this->fee_tax_policy,
            'fee_tax_opinion_recorded' => trim((string) config('payments.fee_tax_opinion_ref')) !== '',
            'is_active' => (bool) $this->is_active,
            'is_usable' => $this->isUsable(),
            'merchant_reference' => $this->merchant_reference,
            'publishable_key' => $this->publishable_key,
            'payment_method_id' => $this->payment_method_id,
            'has_secret_key' => $this->hasSecretKey(),
            'has_webhook_secret' => $this->hasWebhookSecret(),
            'has_extra_credentials' => $this->hasExtraCredentials(),
            'credential_version' => (int) $this->credential_version,
            'previous_secret_valid_until' => $this->previous_secret_expires_at?->isFuture()
                ? $this->previous_secret_expires_at->toISOString()
                : null,
            'capabilities' => $this->capabilities,
            'verified_at' => $this->verified_at?->toISOString(),
            'activated_at' => $this->activated_at?->toISOString(),
            'deactivated_at' => $this->deactivated_at?->toISOString(),
            'webhook_key' => $this->when($canManage, $this->webhook_key),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
