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
            'barcode'         => ['nullable', 'string', 'max:255'],
            'type'            => ['required', 'in:good,service'],
            'unit'            => ['nullable', 'string', 'max:255'],
            'description'     => ['nullable', 'string', 'max:2000'],
            'category'        => ['nullable', 'string', 'max:255'],
            'brand'           => ['nullable', 'string', 'max:255'],
            'reorder_level'   => ['nullable', 'integer', 'min:0'],
            'supplier_id'     => ['nullable', 'uuid'],
            'sales_account_id' => ['nullable', 'uuid'],
            'cogs_account_id' => ['nullable', 'uuid'],
            'min_sale_price'  => ['nullable', 'integer', 'min:0'],
            'discount'        => ['nullable', 'integer', 'min:0'],
            'discount_type'   => ['nullable', 'in:percent,amount'],
            'profit_margin'   => ['nullable', 'integer', 'min:0', 'max:1000'],
            'tags'            => ['nullable', 'string', 'max:500'],
            'internal_notes'  => ['nullable', 'string', 'max:2000'],
            // الأسعار بالهللات (minor units) كأعداد صحيحة
            'sale_price'      => ['required', 'integer', 'min:0'],
            'purchase_price'  => ['nullable', 'integer', 'min:0'],
            'tax_rate'        => ['nullable', 'integer', 'min:0', 'max:100'],
            'track_inventory' => ['boolean'],
            'is_active'       => ['boolean'],
        ];
    }
}
