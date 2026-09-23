<?php

namespace App\Http\Requests;

use App\Models\BuilderApp;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreBuilderAppRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'name_en' => ['nullable', 'string', 'max:255'],
            'creation_source' => ['required', Rule::in(BuilderApp::CREATION_SOURCES)],
        ];
    }
}
