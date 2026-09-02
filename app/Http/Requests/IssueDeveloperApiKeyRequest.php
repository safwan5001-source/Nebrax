<?php

namespace App\Http\Requests;

use App\Support\PublicApiScope;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * إصدار مفتاح إضافي لعميل Public API قائم عبر سطح إدارة المطوّرين الداخلي (PR-7.5).
 * scopes من السجلّ القانوني حصراً. لا يُقبل سرّ من العميل (الخادم يولّده مرّة واحدة).
 */
class IssueDeveloperApiKeyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'            => ['nullable', 'string', 'max:255'],
            'scopes'          => ['required', 'array', 'min:1'],
            'scopes.*'        => ['string', Rule::in(PublicApiScope::all())],
            'expires_in_days' => ['nullable', 'integer', 'min:1', 'max:3650'],
        ];
    }
}
