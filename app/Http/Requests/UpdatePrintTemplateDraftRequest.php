<?php

namespace App\Http\Requests;

use App\Support\DocumentLanguageMode;
use App\Support\PrintTemplateContract;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdatePrintTemplateDraftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'                    => ['sometimes', 'required', 'string', 'max:120'],
            'document_types'           => ['sometimes', 'required', 'array', 'min:1', 'max:13'],
            'document_types.*'         => ['required_with:document_types', 'string', Rule::in(PrintTemplateContract::DOCUMENT_TYPES)],
            'definition'               => ['sometimes', 'required', 'array', 'max:100'],
            'definition.language_mode' => ['sometimes', 'string', Rule::in(DocumentLanguageMode::VALUES)],
            'schema_version'           => ['sometimes', 'integer', 'min:1', 'max:32767'],
        ];
    }
}
