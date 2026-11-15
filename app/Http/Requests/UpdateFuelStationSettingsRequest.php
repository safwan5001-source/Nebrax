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
            'fuel_opening_balance_account_id' => ['sometimes', 'nullable', 'uuid'],
            'shift_opening_meter_reading_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_closing_meter_reading_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_opening_tank_reading_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_closing_tank_reading_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_opening_cash_float_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_mandatory_staff_assignment' => ['sometimes', 'nullable', 'boolean'],
            'shift_mandatory_cash_count' => ['sometimes', 'nullable', 'boolean'],
            'shift_supervisor_approval_required' => ['sometimes', 'nullable', 'boolean'],
            'fuel_distinct_approver_required' => ['sometimes', 'nullable', 'boolean'],
            'shift_allow_close_with_pending_cash_variance' => ['sometimes', 'nullable', 'boolean'],
            'shift_allow_close_with_unresolved_operational_variance' => ['sometimes', 'nullable', 'boolean'],
            'shift_meter_tolerance_milliliters' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'tank_reading_backdating_policy' => ['sometimes', 'nullable', 'in:deny,supervisor_approval,authorized_user'],
            'tank_reading_backdating_max_hours' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:720'],
            'tank_reading_backdating_reason_required' => ['sometimes', 'nullable', 'boolean'],
            'tanker_selection_required' => ['sometimes', 'nullable', 'boolean'],
            'tanker_voucher_unique_scope' => ['sometimes', 'nullable', 'in:station,tenant,owner,none'],
            'tanker_capacity_overrun_policy' => ['sometimes', 'nullable', 'in:allow_with_confirmation,block,allow'],
            'tanker_voucher_attachment_required' => ['sometimes', 'nullable', 'in:never,before_shift_approval,before_settlement'],
            'tanker_fill_attachment_types' => ['sometimes', 'nullable', 'in:images_and_pdf,images_only'],
            'tanker_fill_attachment_max_size_mb' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:10'],
            'tanker_fill_attachment_max_count' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:20'],
            'tanker_fill_attachment_after_close' => ['sometimes', 'nullable', 'in:allow,deny'],
            'tanker_fill_attachment_removal' => ['sometimes', 'nullable', 'in:open_shift_only,always,never'],
            'tanker_inventory_insufficient_policy' => ['sometimes', 'nullable', 'in:block,hold_for_review'],
            'tanker_inventory_review_after_hours' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:720'],
            'tanker_issue_clearing_account_id' => ['sometimes', 'nullable', 'uuid'],
            'tanker_cost_recognition' => ['sometimes', 'nullable', 'in:clearing_until_invoice'],
            'fuel_pool_ledger_variance_policy' => ['sometimes', 'nullable', 'in:block,warn'],
            'tanker_inventory_posting_start_at' => ['sometimes', 'nullable', 'string', 'max:40'],
            'tanker_inventory_alerts_enabled' => ['sometimes', 'nullable', 'boolean'],
            'tank_reading_stale_after_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:43200'],
            'shift_tank_tolerance_milliliters' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'fuel_price_tax_mode' => ['sometimes', 'nullable', 'in:tax_inclusive,tax_exclusive'],
            'corporate_credit_enabled' => ['sometimes', 'nullable', 'boolean'],
            'require_active_contract' => ['sometimes', 'nullable', 'boolean'],
            'default_corporate_credit_limit_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'odometer_policy' => ['sometimes', 'nullable', 'in:disabled,optional,required'],
            'driver_required' => ['sometimes', 'nullable', 'boolean'],
            'vehicle_required' => ['sometimes', 'nullable', 'boolean'],
            'fuel_card_required' => ['sometimes', 'nullable', 'boolean'],
            'fuel_sales_allowed_payment_method_ids' => ['sometimes', 'nullable', 'array'],
            'fuel_sales_allowed_payment_method_ids.*' => ['uuid', 'distinct'],
            'fuel_sales_allow_deferred_payment' => ['sometimes', 'nullable', 'boolean'],
            'shift_expected_cash_basis' => ['sometimes', 'nullable', 'in:movements_only,receiving_shift_receipts,declared_collection'],
            'shift_settlement_mode' => ['sometimes', 'nullable', 'in:none,post_on_close'],
            'shift_settlement_alert_after_hours' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:720'],
            'shift_settlement_escalation_after_hours' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:2160'],
            'avi_rfid_enabled' => ['sometimes', 'nullable', 'boolean'],
            'avi_driver_identity_required' => ['sometimes', 'nullable', 'boolean'],
            'avi_enforce_vehicle_tank_capacity' => ['sometimes', 'nullable', 'boolean'],
            'avi_min_refill_interval_seconds' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'avi_denial_window_seconds' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'avi_repeated_denial_threshold' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'avi_authorization_ttl_seconds' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
