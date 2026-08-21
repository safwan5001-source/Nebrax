<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePosSaleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'          => ['required', 'uuid'],
            // يثبت مخزن الإخراج على الفاتورة الناتجة من عملية نقطة البيع.
            'warehouse_id'        => ['nullable', 'uuid'],
            'tax_inclusive'       => ['nullable', 'boolean'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['nullable', 'uuid'],
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit_price'  => ['required', 'integer', 'min:0', 'max:100000000000'], // هللات
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
            'items.*.discount'    => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات
            'items.*.minimum_price_override_reason' => ['nullable', 'string', 'min:3', 'max:500'],
            'tenders'             => ['required', 'array'],
            'tenders.cash'        => ['nullable', 'integer', 'min:0'],
            'tenders.card'        => ['nullable', 'integer', 'min:0'],
            'tenders.transfer'    => ['nullable', 'integer', 'min:0'],
            'tenders.credit'      => ['nullable', 'integer', 'min:0'],
        ];
    }
}
