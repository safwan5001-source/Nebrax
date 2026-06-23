<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'      => ['sometimes', 'required', 'string', 'max:255'],
            'role'      => ['sometimes', 'required', 'in:owner,admin,accountant,staff'],
            'password'  => ['nullable', 'string', 'min:8'],
            'is_active' => ['boolean'],
        ];
    }
}
