<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePriceListItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'product_id' => ['required', 'uuid'],
            // الغياب أو الفراغ يعني وحدة أساس المنتج؛ الخدمة تتحقق من البديل عبر
            // UnitConversion لأن صحة الاسم لا تعرف من FormRequest وحده.
            'unit_name' => ['nullable', 'string', 'max:255'],
            'price' => ['required', 'integer', 'min:0', 'max:100000000000'],
        ];
    }
}
