<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreStocktakeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'warehouse_id'   => ['required', 'uuid'],
            'stocktake_date' => ['nullable', 'date'],
            'notes'          => ['nullable', 'string', 'max:500'],
            // أصناف محدَّدة، أو الغياب = كل ما في المخزن
            'product_ids'    => ['nullable', 'array'],
            'product_ids.*'  => ['uuid'],
        ];
    }
}
