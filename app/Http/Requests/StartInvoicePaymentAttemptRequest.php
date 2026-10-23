<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * بدء محاولة دفع لطلب: `Idempotency-Key` في الرأس إلزامي. `amount_minor` (هللات) اختياري: غيابه = المتبقي كاملاً؛ الجزئي يتطلب رابطاً
 * فعّله (D-16) ويتحقق منه الخادم. لا مبلغ بالريال ولا عشري (النقود صحيحة بالهللات).
 */
class StartInvoicePaymentAttemptRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return ['amount_minor' => ['nullable', 'integer', 'min:1']];
    }
}
