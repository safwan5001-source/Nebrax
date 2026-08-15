<?php

namespace App\Http\Requests;

use App\Support\PrintTemplateContract;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpsertPrintTemplateAssignmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'branch_id'                   => ['sometimes', 'nullable', 'uuid'],
            'document_type'               => ['required', 'string', Rule::in(PrintTemplateContract::DOCUMENT_TYPES)],
            'usage'                       => ['sometimes', 'string', Rule::in(PrintTemplateContract::USAGES)],
            'print_template_revision_id'  => ['required', 'uuid'],
        ];
    }
}
