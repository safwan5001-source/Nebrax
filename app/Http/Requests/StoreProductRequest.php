<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'            => ['required', 'string', 'max:255'],
            'name_en'         => ['nullable', 'string', 'max:255'],
            'sku'             => ['nullable', 'string', 'max:255'],
            'type'            => ['required', 'in:good,service'],
            'unit'            => ['nullable', 'string', 'max:255'],
            // الأسعار بالهللات (minor units) كأعداد صحيحة
            'sale_price'      => ['required', 'integer', 'min:0'],
            'purchase_price'  => ['nullable', 'integer', 'min:0'],
            'tax_rate'        => ['nullable', 'integer', 'min:0', 'max:100'],
            'track_inventory' => ['boolean'],
            'is_active'       => ['boolean'],
        ];
    }
}
