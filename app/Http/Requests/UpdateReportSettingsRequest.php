<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateReportSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'allow_classification_edit_before_post' => ['sometimes', 'boolean'],
            'allow_classification_edit_after_post' => ['sometimes', 'boolean'],
        ];
    }
}
