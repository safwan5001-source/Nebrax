<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreEmployeeCustodyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_id' => ['required', 'uuid'],
            // غيابه يعني حساب 1160 النظامي؛ إن أُرسل يتحقق منه المتحكم والخدمة.
            'custody_account_id' => ['nullable', 'uuid'],
            'cash_account_id' => ['nullable', 'uuid'],
            'method' => ['required', 'in:cash,bank'],
            'custody_date' => ['required', 'date'],
            'due_date' => ['nullable', 'date', 'after_or_equal:custody_date'],
            'amount' => ['required', 'integer', 'min:1', 'max:100000000000'], // هللات
            'notes' => ['nullable', 'string'],
        ];
    }
}
