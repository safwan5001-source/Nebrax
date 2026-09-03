<?php

namespace App\Http\Requests;

use App\Support\DocumentTypeCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDocumentBatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        // التصنيف مصدره الوحيد `DocumentTypeCatalog` — لا قائمة موازية هنا.
        return [
            'document_type' => ['required', 'string', Rule::in(DocumentTypeCatalog::all())],
        ];
    }
}
