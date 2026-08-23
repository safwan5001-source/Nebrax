<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CommercialAssignmentPreviewRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'source_type' => ['required', Rule::in(['plan', 'addon', 'trial'])],
            'version_id' => ['required', 'uuid'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['nullable', 'date', 'after:starts_at'],
            'duration_days' => ['nullable', 'integer', 'min:1', 'max:90', 'required_if:source_type,trial'],
            'trial_target' => ['nullable', Rule::in(['plan', 'addon']), 'required_if:source_type,trial'],
        ];
    }
}
