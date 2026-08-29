<?php

namespace App\Http\Requests;

use App\Support\ApplicationCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PlatformApplicationOverrideRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'application_key' => ['required', 'string', Rule::in(ApplicationCatalog::keys())],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
