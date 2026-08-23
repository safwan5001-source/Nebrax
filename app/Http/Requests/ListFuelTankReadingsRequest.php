<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ListFuelTankReadingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'fuel_tank_id' => ['nullable', 'uuid'],
        ];
    }
}
