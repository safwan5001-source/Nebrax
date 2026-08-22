<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreProductBarcodeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:255'],
            'unit_name' => ['nullable', 'string', 'max:255'],
            'default_quantity' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'label' => ['nullable', 'string', 'max:255'],
        ];
    }
}
