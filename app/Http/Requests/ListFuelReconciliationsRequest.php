<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ListFuelReconciliationsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['nullable', 'uuid'],
            'fuel_tank_id' => ['nullable', 'uuid'],
            'status' => ['nullable', 'in:draft,approved'],
        ];
    }
}
