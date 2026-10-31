<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * H6 Batch M — wholesale application: the buyer may give optional, unverified company/phone context for the reviewer.
 * Anything that would let the buyer pick their own commercial terms (partner, price list, tenant/channel/identity) is refused
 * outright. `status` and other unknown fields are ignored exactly as before (the membership state machine is staff-only).
 */
class BuyerApplyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'company_name' => ['sometimes', 'nullable', 'string', 'max:150'],
            'contact_phone' => ['sometimes', 'nullable', 'string', 'regex:/^\+?[0-9][0-9 ()\-]{5,28}$/'],
            'tenant_id' => ['prohibited'],
            'customer_identity_id' => ['prohibited'],
            'sales_channel_id' => ['prohibited'],
            'partner_id' => ['prohibited'],
            'price_list_id' => ['prohibited'],
        ];
    }
}
