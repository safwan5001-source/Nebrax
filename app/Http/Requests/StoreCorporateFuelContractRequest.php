<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreCorporateFuelContractRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'partner_id' => ['required', 'uuid'],
            'effective_from' => ['required', 'date'],
            'effective_until' => ['nullable', 'date', 'after:effective_from'],
            'credit_limit_minor' => ['required', 'integer', 'min:0'],
            'payment_terms_days' => ['sometimes', 'integer', 'min:0'],
            'station_restriction_mode' => ['sometimes', 'in:all,selected'],
            'station_ids' => ['sometimes', 'array'],
            'station_ids.*' => ['uuid', 'distinct'],
            'fuel_restriction_mode' => ['sometimes', 'in:all,selected'],
            'fuel_product_ids' => ['sometimes', 'array'],
            'fuel_product_ids.*' => ['uuid', 'distinct'],
            'odometer_policy' => ['nullable', 'in:disabled,optional,required'],
            'driver_required' => ['nullable', 'boolean'],
            'vehicle_required' => ['nullable', 'boolean'],
            'fuel_card_required' => ['nullable', 'boolean'],
            'billing_mode' => ['prohibited'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
