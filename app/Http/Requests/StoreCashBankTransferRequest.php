<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreCashBankTransferRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'source_cash_bank_account_id' => ['required', 'uuid', 'different:destination_cash_bank_account_id'],
            'destination_cash_bank_account_id' => ['required', 'uuid'],
            'amount' => ['required', 'integer', 'min:1', 'max:100000000000'], // هللات
            'transfer_date' => ['nullable', 'date'],
            'reference' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
