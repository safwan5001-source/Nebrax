<?php

namespace App\Http\Requests;

use App\Models\PaymentGateway;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** إنشاء اتصال بوابة دفع (مسودة). الحقول خارج هذه القائمة — الحالة والإصدار والمفتاح — لا يمرّرها العميل. */
class StorePaymentGatewayRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'provider' => ['required', 'string', Rule::in(PaymentGateway::PROVIDERS)],
            'name' => ['required', 'string', 'max:255'],
            'name_en' => ['nullable', 'string', 'max:255'],
            'environment' => ['sometimes', 'string', Rule::in(PaymentGateway::ENVIRONMENTS)],
            'merchant_reference' => ['nullable', 'string', 'max:255'],
            'publishable_key' => ['nullable', 'string', 'max:255'],
            'secret_key' => ['nullable', 'string', 'max:2000'],
            'webhook_secret' => ['nullable', 'string', 'max:2000'],
            'extra_credentials' => ['nullable', 'array', 'max:20'],
            'payment_method_id' => ['nullable', 'uuid'],
        ];
    }
}
