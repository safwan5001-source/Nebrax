<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateCorporateFuelContractRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'partner_id' => ['prohibited'],
            'billing_mode' => ['prohibited'],
            'effective_from' => ['sometimes', 'date'],
            'effective_until' => ['sometimes', 'nullable', 'date'],
            'credit_limit_minor' => ['sometimes', 'integer', 'min:0'],
            'payment_terms_days' => ['sometimes', 'integer', 'min:0'],
            'station_restriction_mode' => ['sometimes', 'in:all,selected'],
            'station_ids' => ['sometimes', 'array'],
            'station_ids.*' => ['uuid', 'distinct'],
            'fuel_restriction_mode' => ['sometimes', 'in:all,selected'],
            'fuel_product_ids' => ['sometimes', 'array'],
            'fuel_product_ids.*' => ['uuid', 'distinct'],
            'odometer_policy' => ['sometimes', 'nullable', 'in:disabled,optional,required'],
            'driver_required' => ['sometimes', 'nullable', 'boolean'],
            'vehicle_required' => ['sometimes', 'nullable', 'boolean'],
            'fuel_card_required' => ['sometimes', 'nullable', 'boolean'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
