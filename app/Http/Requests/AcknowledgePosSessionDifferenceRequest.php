<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class AcknowledgePosSessionDifferenceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'note' => ['required', 'string', 'min:3', 'max:2000'],
        ];
    }
}
