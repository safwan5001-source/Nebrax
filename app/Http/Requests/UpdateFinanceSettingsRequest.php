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
            'payment_fee_application' => ['sometimes', 'in:received,paid,both,none'],
        ];
    }
}
