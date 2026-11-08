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
            'grni_account_id' => ['sometimes', 'nullable', 'uuid'],
            'fuel_opening_balance_account_id' => ['sometimes', 'nullable', 'uuid'],
            'shift_opening_meter_reading_required' => ['sometimes', 'boolean'],
            'shift_closing_meter_reading_required' => ['sometimes', 'boolean'],
            'shift_opening_tank_reading_required' => ['sometimes', 'boolean'],
            'shift_closing_tank_reading_required' => ['sometimes', 'boolean'],
            'shift_opening_cash_float_required' => ['sometimes', 'boolean'],
            'shift_mandatory_staff_assignment' => ['sometimes', 'boolean'],
            'shift_mandatory_cash_count' => ['sometimes', 'boolean'],
            'shift_supervisor_approval_required' => ['sometimes', 'boolean'],
            'fuel_distinct_approver_required' => ['sometimes', 'boolean'],
            'shift_allow_close_with_pending_cash_variance' => ['sometimes', 'boolean'],
            'shift_allow_close_with_unresolved_operational_variance' => ['sometimes', 'boolean'],
            'shift_meter_tolerance_milliliters' => ['sometimes', 'integer', 'min:0'],
            'tank_reading_backdating_policy' => ['sometimes', 'in:deny,supervisor_approval,authorized_user'],
            'tank_reading_backdating_max_hours' => ['sometimes', 'integer', 'min:1', 'max:720'],
            'tank_reading_backdating_reason_required' => ['sometimes', 'boolean'],
            'tank_reading_stale_after_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:43200'],
            'shift_tank_tolerance_milliliters' => ['sometimes', 'integer', 'min:0'],
            'fuel_price_tax_mode' => ['sometimes', 'in:tax_inclusive,tax_exclusive'],
            'corporate_credit_enabled' => ['sometimes', 'boolean'],
            'require_active_contract' => ['sometimes', 'boolean'],
            'default_corporate_credit_limit_minor' => ['sometimes', 'integer', 'min:0'],
            'odometer_policy' => ['sometimes', 'in:disabled,optional,required'],
            'driver_required' => ['sometimes', 'boolean'],
            'vehicle_required' => ['sometimes', 'boolean'],
            'fuel_card_required' => ['sometimes', 'boolean'],
            'fuel_sales_allowed_payment_method_ids' => ['sometimes', 'array'],
            'fuel_sales_allowed_payment_method_ids.*' => ['uuid', 'distinct'],
            'fuel_sales_allow_deferred_payment' => ['sometimes', 'boolean'],
            'shift_expected_cash_basis' => ['sometimes', 'in:movements_only,receiving_shift_receipts,declared_collection'],
            'shift_settlement_mode' => ['sometimes', 'in:none,post_on_close'],
            'avi_rfid_enabled' => ['sometimes', 'boolean'],
            'avi_driver_identity_required' => ['sometimes', 'boolean'],
            'avi_enforce_vehicle_tank_capacity' => ['sometimes', 'boolean'],
            'avi_min_refill_interval_seconds' => ['sometimes', 'integer', 'min:0'],
            'avi_denial_window_seconds' => ['sometimes', 'integer', 'min:1'],
            'avi_repeated_denial_threshold' => ['sometimes', 'integer', 'min:1'],
            'avi_authorization_ttl_seconds' => ['sometimes', 'integer', 'min:1'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
