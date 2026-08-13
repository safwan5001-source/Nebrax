<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePaymentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'             => ['required', 'uuid'],
            'amount'                 => ['required', 'integer', 'min:1', 'max:100000000000'], // هللات
            'direction'              => ['required', 'in:received,paid'],
            'method'                 => ['required', 'in:cash,bank'],
            'reference'              => ['nullable', 'string', 'max:255'], // رقم الحوالة/الشبكة
            'cash_account_id'        => ['nullable', 'uuid'],              // الخزينة — يتحقق نوعها PaymentService
            'payment_date'           => ['nullable', 'date'],
            'invoice_id'             => ['nullable', 'uuid'],
            'purchase_id'            => ['nullable', 'uuid'],
            'notes'                  => ['nullable', 'string'],
            'allocations'            => ['nullable', 'array'],
            'allocations.*.invoice_id'  => ['nullable', 'uuid'],
            'allocations.*.purchase_id' => ['nullable', 'uuid'],
            'allocations.*.amount'      => ['required_with:allocations', 'integer', 'min:1'],
        ];
    }
}
