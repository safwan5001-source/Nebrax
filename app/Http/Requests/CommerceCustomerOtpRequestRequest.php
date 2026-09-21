<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * COM-MOBILE-AUTH-1 — same E.164 shape already enforced by
 * `CustomerRegisterRequest`. Full smart local-to-+966 normalization is
 * explicitly deferred (open policy decision, not a bug); the client must
 * submit an already-normalized `+<countrycode><number>` phone.
 */
class CommerceCustomerOtpRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'phone' => ['required', 'string', 'regex:/^\+[1-9][0-9]{7,14}$/'],
            'tenant_id' => ['prohibited'],
            'customer_id' => ['prohibited'],
            'customer_identity_id' => ['prohibited'],
            'partner_id' => ['prohibited'],
        ];
    }
}
