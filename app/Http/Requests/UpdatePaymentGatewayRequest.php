<?php

namespace App\Http\Requests;

use App\Models\PaymentGateway;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * تعديل الحقول غير السرّية. لا أسرار ولا حالة هنا: الأسرار عبر التدوير، والحالة عبر
 * التفعيل/الإيقاف/الإلغاء. `provider` مقبول فقط ليرفضه الخادم بسبب ثابت إن اختلف.
 */
class UpdatePaymentGatewayRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'provider' => ['sometimes', 'string', Rule::in(PaymentGateway::PROVIDERS)],
            'name' => ['sometimes', 'string', 'max:255'],
            'name_en' => ['nullable', 'string', 'max:255'],
            'environment' => ['sometimes', 'string', Rule::in(PaymentGateway::ENVIRONMENTS)],
            'merchant_reference' => ['nullable', 'string', 'max:255'],
            'publishable_key' => ['nullable', 'string', 'max:255'],
            'payment_method_id' => ['nullable', 'uuid'],
        ];
    }
}
