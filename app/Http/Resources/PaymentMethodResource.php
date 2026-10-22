<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PaymentMethodResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'name_en' => $this->name_en,
            'settlement_type' => $this->settlement_type,
            'cash_bank_account_id' => $this->cash_bank_account_id,
            'cash_bank_account_name' => $this->cashBankAccount?->name,
            'cash_account_id' => $this->cashBankAccount?->account_id,
            'instructions' => $this->instructions,
            'available_online' => $this->available_online,
            'is_active' => $this->is_active,
            'is_default' => $this->is_default,
            // D-09: مقاصة POS (NULL = مطفأة). اسم الاتصال وصلاحيته للعرض فقط — لا أسرار.
            'pos_clearing_gateway_id' => $this->pos_clearing_gateway_id,
            'pos_clearing_gateway_name' => $this->whenLoaded('posClearingGateway', fn () => $this->posClearingGateway?->name),
            'pos_clearing_gateway_usable' => $this->whenLoaded('posClearingGateway', fn () => $this->posClearingGateway?->isUsable()),
            'payments_count' => $this->when(isset($this->payments_count), $this->payments_count),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
