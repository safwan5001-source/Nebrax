<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * FS-35: طريقة تحصيل لبيع الوقود — ما تحتاجه شاشة التحصيل فقط. لا `cash_bank_account_id` (ربط الأستاذ)
 * ولا تعليمات/إعدادات الدفع الإلكتروني ولا `tenant_id`.
 */
class FuelSalePaymentMethodResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'name_en' => $this->name_en,
            'settlement_type' => $this->settlement_type,
            'is_active' => (bool) $this->is_active,
        ];
    }
}
