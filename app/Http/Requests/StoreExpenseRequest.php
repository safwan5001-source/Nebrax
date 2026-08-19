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
            'category_id'    => ['nullable', 'uuid'],
            'partner_id'     => ['nullable', 'uuid'],
            'vendor_name'    => ['nullable', 'string', 'max:180'],
            'cost_center_id' => ['nullable', 'uuid'],
            'expense_date'   => ['nullable', 'date'],
            'payment_method' => ['nullable', 'in:cash,bank,credit'],
            'description'    => ['nullable', 'string', 'max:1000'],
            'amount'         => ['required', 'integer', 'min:1', 'max:100000000000'], // هللات
            'tax_rate'       => ['nullable', 'integer', 'min:0', 'max:100'],
            'attachments'    => ['nullable', 'array', 'max:10'],
            'attachments.*'  => ['file', 'max:10240', 'mimes:pdf,doc,docx,xls,xlsx,csv,jpg,jpeg,png,gif,zip'],
        ];
    }
}
