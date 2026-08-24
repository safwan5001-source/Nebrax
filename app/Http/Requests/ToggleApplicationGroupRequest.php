<?php

namespace App\Http\Requests;

use App\Support\ApplicationCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ToggleApplicationGroupRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $groups = array_values(array_unique(array_map(
            fn (array $application) => $application['group'],
            ApplicationCatalog::all(),
        )));

        return [
            'group_key' => ['required', 'string', Rule::in($groups)],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'group_key.in' => 'مفتاح تطبيق رئيسي غير معروف.',
        ];
    }
}
