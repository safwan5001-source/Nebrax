<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePosDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'         => ['required', 'string', 'min:2', 'max:120'],
            'code'         => ['nullable', 'string', 'max:64'],
            'warehouse_id' => ['required', 'uuid'],
            'notes'        => ['nullable', 'string', 'max:2000'],
            'is_active'    => ['sometimes', 'boolean'],
        ];
    }
}
