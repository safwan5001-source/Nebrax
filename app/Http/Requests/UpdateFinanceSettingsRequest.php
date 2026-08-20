<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateFinanceSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'allow_negative_transfer_balance' => ['sometimes', 'boolean'],
            'financial_alerts_enabled' => ['sometimes', 'boolean'],
            'alert_check_window_days' => ['sometimes', 'integer', 'min:1', 'max:90'],
        ];
    }
}
