<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** TANKER-PR1: إنهاء ربط مفتوح بتاريخ (الافتراضي اليوم) وسبب اختياري. */
class EndFuelTankerOwnerLinkRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'valid_to' => ['nullable', 'date_format:Y-m-d'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
