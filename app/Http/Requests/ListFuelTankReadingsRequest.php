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
            // FUEL-B6: سجل مرقَّم اختياري؛ بدون `per_page` يبقى السلوك القديم (القائمة كاملة) لمستهلكي الاستلام والتسوية.
            'fuel_station_id' => ['nullable', 'uuid'],
            'reading_type' => ['nullable', 'in:physical,atg'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ];
    }
}
