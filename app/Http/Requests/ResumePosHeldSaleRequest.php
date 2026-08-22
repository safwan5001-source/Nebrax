<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ResumePosHeldSaleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'pos_session_id' => ['required', 'uuid'],
        ];
    }
}
