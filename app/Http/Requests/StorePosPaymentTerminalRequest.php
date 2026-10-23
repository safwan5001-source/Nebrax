<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePosPaymentTerminalRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'code' => ['nullable', 'string', 'max:64'],
            // المزوّد غير قابل للتغيير بعد الإنشاء (PUT يمنعه)؛ توفّر محوّله تفحصه الخدمة (لا مزوّد بلا محوّل).
            'provider' => ['required', 'string', 'regex:/^[a-z0-9_]{2,32}$/'],
            'pos_device_id' => ['nullable', 'uuid'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
