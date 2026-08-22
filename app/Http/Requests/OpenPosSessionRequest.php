<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class OpenPosSessionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'opening_balance' => ['required', 'integer', 'min:0'], // هللات
            'pos_device_id'  => ['required', 'uuid'],
            'shift_id'       => ['nullable', 'uuid'],
        ];
    }
}
