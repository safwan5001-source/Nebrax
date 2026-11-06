<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelTankReadingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'fuel_station_id' => ['required', 'uuid'],
            'fuel_tank_id' => ['required', 'uuid'],
            'reading_type' => ['required', 'in:physical,atg'],
            'quantity_liters' => ['required', 'string', 'max:32'],
            'evidence_key' => ['required', 'string', 'max:128'],
            // FUEL-B6: الدليل بيانات وصفية صغيرة (طريقة القياس + ملاحظة)؛ مفاتيح أخرى تبقى مقبولة للتوافق لكن بسقف عددي.
            'evidence' => ['nullable', 'array', 'max:20'],
            'evidence.method' => ['nullable', 'string', 'in:dipstick,gauge,atg_console,other'],
            'evidence.note' => ['nullable', 'string', 'max:500'],
            'measured_at' => ['nullable', 'date'],
        ];
    }
}
