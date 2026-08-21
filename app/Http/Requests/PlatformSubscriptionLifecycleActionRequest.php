<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class PlatformSubscriptionLifecycleActionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'effective_on' => ['required', 'date'],
            'reason'       => ['nullable', 'string', 'max:1000'],
        ];
    }
}
