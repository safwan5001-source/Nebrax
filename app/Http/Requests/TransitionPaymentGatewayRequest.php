<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** تفعيل/إيقاف/إلغاء اعتماد اتصال: سبب اختياري (إلزامي عند الإلغاء — يفرضه الخادم). */
class TransitionPaymentGatewayRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
