<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreSupplierRefundRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'        => ['required', 'uuid'],
            'amount'            => ['required', 'integer', 'min:1', 'max:100000000000'],
            'method'            => ['nullable', 'in:cash,bank'],
            'payment_method_id' => ['nullable', 'uuid'],
            'cash_account_id'   => ['nullable', 'uuid'],
            'refund_date'       => ['nullable', 'date'],
            'reference'         => ['nullable', 'string', 'max:255'],
            'notes'             => ['nullable', 'string'],
            // V1: الاسترداد مخصَّصٌ بالكامل على مرتجعات مشتريات مرحّلة —
            // لا استرداد «على الحساب» بلا تخصيص (عقدٌ مستقل لم يُقرّ بعد).
            'allocations'                          => ['required', 'array', 'min:1'],
            'allocations.*.purchase_return_id'     => ['required', 'uuid'],
            'allocations.*.amount'                 => ['required', 'integer', 'min:1', 'max:100000000000'],
        ];
    }
}
