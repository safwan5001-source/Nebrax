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
            // AD-11: مفتاح قالب من السجل؛ لا يُقبل إلا مع `creation_source = template`.
            'template_key' => [
                'nullable', 'string', 'max:40',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value === null) {
                        return;
                    }
                    if ($this->input('creation_source') !== 'template') {
                        $fail('template_key لا يُستعمل إلا مع creation_source = template.');
                    } elseif (app(\App\Services\AppBuilder\AppTemplateRegistry::class)->find((string) $value) === null) {
                        $fail('القالب غير موجود.');
                    }
                },
            ],
        ];
    }
}
