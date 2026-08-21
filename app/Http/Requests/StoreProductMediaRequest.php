<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreProductMediaRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'media' => ['required', 'array', 'min:1', 'max:8'],
            'media.*' => ['required', 'file', 'max:5120', 'mimes:jpg,jpeg,png,webp'],
        ];
    }
}
