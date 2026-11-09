<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** TANKER-PR1: ربط شركة (عميل) بصاحب صهريج من تاريخ (الافتراضي اليوم) وحتى تاريخ اختياري. */
class StoreFuelTankerOwnerLinkRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'partner_id' => ['required', 'uuid'],
            'valid_from' => ['nullable', 'date_format:Y-m-d'],
            'valid_to' => ['nullable', 'date_format:Y-m-d'],
            'note' => ['nullable', 'string', 'max:1000'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
