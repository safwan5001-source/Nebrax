<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RejectEmployeeRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'rejection_reason' => ['nullable', 'string'],
        ];
    }
}
