<?php

namespace App\Http\Requests;

use App\Models\FuelAviIdentityTag;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreFuelAviIdentityTagRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'public_identifier' => ['required', 'string', 'max:120'],
            'credential' => ['required', 'string', 'min:1', 'max:512'],
            'identity_type' => ['required', 'string', Rule::in(FuelAviIdentityTag::IDENTITY_TYPES)],
            'partner_id' => ['required', 'uuid'],
            'corporate_fuel_contract_id' => ['required', 'uuid'],
            'fuel_card_id' => ['nullable', 'uuid'],
            'fuel_fleet_vehicle_id' => ['nullable', 'uuid'],
            'fuel_fleet_driver_id' => ['nullable', 'uuid'],
            'status' => ['sometimes', 'string', Rule::in(FuelAviIdentityTag::STATUSES)],
            'effective_from' => ['nullable', 'date'],
            'effective_until' => ['nullable', 'date', 'after:effective_from'],
            'replaces_fuel_avi_identity_tag_id' => ['nullable', 'uuid'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
