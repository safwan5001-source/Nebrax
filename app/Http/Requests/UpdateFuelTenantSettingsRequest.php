<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateFuelTenantSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'reconciliation_tolerance_absolute_milliliters' => ['sometimes', 'integer', 'min:0'],
            'reconciliation_tolerance_basis_points' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
            'inventory_variance_account_id' => ['sometimes', 'nullable', 'uuid'],
            'inventory_gain_account_id' => ['sometimes', 'nullable', 'uuid'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
