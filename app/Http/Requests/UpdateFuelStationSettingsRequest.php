<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateFuelStationSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'reconciliation_tolerance_absolute_milliliters' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'reconciliation_tolerance_basis_points' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000000'],
            'inventory_variance_account_id' => ['sometimes', 'nullable', 'uuid'],
            'inventory_gain_account_id' => ['sometimes', 'nullable', 'uuid'],
            'grni_account_id' => ['sometimes', 'nullable', 'uuid'],
            'shift_opening_meter_reading_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_closing_meter_reading_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_opening_tank_reading_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_closing_tank_reading_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_opening_cash_float_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_mandatory_staff_assignment' => ['sometimes', 'nullable', 'boolean'],
            'shift_mandatory_cash_count' => ['sometimes', 'nullable', 'boolean'],
            'shift_supervisor_approval_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_allow_close_with_pending_cash_variance' => ['sometimes', 'nullable', 'boolean'],
            'shift_allow_close_with_unresolved_operational_variance' => ['sometimes', 'nullable', 'boolean'],
            'shift_meter_tolerance_milliliters' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'shift_tank_tolerance_milliliters' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'fuel_price_tax_mode' => ['sometimes', 'nullable', 'in:tax_inclusive,tax_exclusive'],
            'fuel_sales_allowed_payment_method_ids' => ['sometimes', 'nullable', 'array'],
            'fuel_sales_allowed_payment_method_ids.*' => ['uuid', 'distinct'],
            'fuel_sales_allow_deferred_payment' => ['sometimes', 'nullable', 'boolean'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
