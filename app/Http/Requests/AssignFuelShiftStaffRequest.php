<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class AssignFuelShiftStaffRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'user_id' => ['required', 'uuid'],
            'role' => ['required', 'string', 'max:64'],
        ];
    }
}
