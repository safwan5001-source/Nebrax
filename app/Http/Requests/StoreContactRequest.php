<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreContactRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id' => ['nullable', 'uuid'],
            'name'       => ['required', 'string', 'max:255'],
            'job_title'  => ['nullable', 'string', 'max:255'],
            'email'      => ['nullable', 'email', 'max:255'],
            'phone'      => ['nullable', 'string', 'max:50'],
            'notes'      => ['nullable', 'string', 'max:1000'],
        ];
    }
}
