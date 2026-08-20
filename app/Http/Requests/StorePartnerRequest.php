<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePartnerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'       => ['required', 'string', 'max:255'],
            'name_en'    => ['nullable', 'string', 'max:255'],
            'type'       => ['required', 'in:customer,supplier,both'],
            'entity_type' => ['nullable', 'in:individual,commercial'],
            'code'       => ['nullable', 'string', 'max:255'],
            'vat_number' => ['nullable', 'string', 'size:15'],
            'cr_number'  => ['nullable', 'string', 'max:255'],
            'email'      => ['nullable', 'email', 'max:255'],
            'phone'      => ['nullable', 'string', 'max:255'],
            'mobile'     => ['nullable', 'string', 'max:255'],
            'address'    => ['nullable', 'string', 'max:255'],
            'city'       => ['nullable', 'string', 'max:255'],
            'building_no'  => ['nullable', 'string', 'max:255'],
            'street'       => ['nullable', 'string', 'max:255'],
            'district'     => ['nullable', 'string', 'max:255'],
            'postal_code'  => ['nullable', 'string', 'max:255'],
            'country'      => ['nullable', 'string', 'max:255'],
            'classification' => ['nullable', 'string', 'max:255'], // انتقالياً للتوافق الرجعي
            'customer_classification_id' => ['nullable', 'uuid'],
            'supplier_classification_id' => ['nullable', 'uuid'],
            'credit_limit'  => ['nullable', 'integer', 'min:0'],   // هللات — 0/غياب = بلا حد
            'credit_period' => ['nullable', 'integer', 'min:0', 'max:3650'], // أيام
            'opening_balance'      => ['nullable', 'integer', 'min:0'], // هللات — فعل (قيد) لا عمود
            'opening_balance_date' => ['nullable', 'date'],
            'is_active'  => ['boolean'],
        ];
    }
}
