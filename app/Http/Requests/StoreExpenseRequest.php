<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreExpenseRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'account_id'     => ['required', 'uuid'],
            'partner_id'     => ['nullable', 'uuid'],
            'cost_center_id' => ['nullable', 'uuid'],
            'expense_date'   => ['nullable', 'date'],
            'payment_method' => ['nullable', 'in:cash,bank,credit'],
            'description'    => ['nullable', 'string', 'max:500'],
            'amount'         => ['required', 'integer', 'min:1'], // هللات
            'tax_rate'       => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }
}
