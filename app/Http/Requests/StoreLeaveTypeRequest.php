<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreLeaveTypeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'              => ['required', 'string', 'max:255'],
            'is_paid'           => ['boolean'],
            'annual_days'       => ['required', 'integer', 'min:0'],
            'requires_approval' => ['boolean'],
            'is_active'         => ['boolean'],
        ];
    }
}
