<?php

namespace App\Http\Requests;

use App\Support\ApplicationCatalog;
use Illuminate\Foundation\Http\FormRequest;

class ToggleApplicationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'application_key' => ['required', 'string', 'in:' . implode(',', ApplicationCatalog::keys())],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'application_key.in' => 'مفتاح تطبيق غير معروف.',
        ];
    }
}
