<?php

namespace App\Http\Requests;

use App\Models\CommerceShippingZone;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCommerceShippingZoneRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'match_type' => ['required', Rule::in(CommerceShippingZone::MATCH_TYPES)],
            'match_value' => ['required', 'string', 'max:255'],
            'rate_amount_minor' => ['required', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
