<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFuelStationSimulatedEventRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type' => ['required', 'string', 'max:64'],
            'event_id' => ['required', 'string', 'max:128'],
            'occurred_at' => ['required', 'date'],
            'sequence' => ['nullable', 'integer', 'min:0'],
            'correlation_id' => ['nullable', 'string', 'max:128'],
            'payload' => ['required', 'array'],
        ];
    }
}
