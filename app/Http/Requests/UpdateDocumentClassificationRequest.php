<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateDocumentClassificationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // nullable + present يفرّق بين «امسح التصنيف» وغياب الحقل.
            'classification_id' => ['present', 'nullable', 'uuid'],
        ];
    }
}
