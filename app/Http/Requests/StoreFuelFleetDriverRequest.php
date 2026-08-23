<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelFleetDriverRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'partner_id' => ['nullable', 'uuid'],
            'corporate_fuel_contract_id' => ['nullable', 'uuid'],
            'employee_id' => ['nullable', 'uuid'],
            'name' => ['required', 'string', 'max:255'],
            'identifier' => ['nullable', 'string', 'max:100'],
            'mobile' => ['nullable', 'string', 'max:50'],
            'status' => ['sometimes', 'in:active,suspended,inactive'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
