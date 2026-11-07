<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class DecideFuelReadingRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return ['note' => ['nullable', 'string', 'max:500']];
    }
}
