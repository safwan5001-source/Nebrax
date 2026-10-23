<?php

namespace App\Http\Resources;

use App\Models\PaymentAttempt;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * طلب دفع فاتورة. لا يكشف `token_hash` ولا أسرار البوابة. `latest_attempt` ملخص المحاولة الأحدث (حالة وتاريخ ومبلغ، ورابط الدفع للنشطة فقط).
 */
class InvoicePaymentRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $attempt = PaymentAttempt::query()->where('payable_key', $this->payableKey())->latest('created_at')->first();

        return [
            'id' => $this->id,
            'invoice_id' => $this->invoice_id,
            'payment_gateway_id' => $this->payment_gateway_id,
            'status' => $this->status,
            'allow_partial' => (bool) $this->allow_partial,
            // هل أُصدر رابط الدفع العام؟ (الرمز لا يُعاد أبداً؛ هذا مؤشر لإظهار/إخفاء إجراء «إصدار الرابط» في الواجهة.)
            'link_issued' => $this->token_hash !== null,
            'currency' => $this->currency,
            'expires_at' => $this->expires_at?->toISOString(),
            'cancelled_at' => $this->cancelled_at?->toISOString(),
            'created_at' => $this->created_at?->toISOString(),
            'latest_attempt' => $attempt === null ? null : [
                'id' => $attempt->id,
                'capture_status' => $attempt->capture_status,
                'amount_minor' => (int) $attempt->amount_minor,
                'captured_minor' => (int) $attempt->captured_minor,
                'posting_status' => $attempt->posting_status,
                'checkout_url' => $attempt->isActive() ? $attempt->checkout_url : null,
                'review_reasons' => $attempt->review_reasons,
            ],
        ];
    }
}
