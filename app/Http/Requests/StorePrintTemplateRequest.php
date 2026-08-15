<?php

namespace App\Http\Requests;

use App\Support\PrintTemplateContract;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePrintTemplateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'                    => ['required', 'string', 'max:120'],
            'document_types'           => ['required', 'array', 'min:1', 'max:13'],
            'document_types.*'         => ['required', 'string', Rule::in(PrintTemplateContract::DOCUMENT_TYPES)],
            'definition'               => ['required', 'array', 'max:100'],
            'schema_version'           => ['sometimes', 'integer', 'min:1', 'max:32767'],
        ];
    }
}
