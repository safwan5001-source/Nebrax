<?php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/** AWJ-MULTI-STORE-1 — لا يقبل أي هوية تقنية أو tenant_id من العميل. */
class CreateStorefrontRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'default_locale' => ['sometimes', 'nullable', 'string', 'in:ar,en'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $name = $this->input('name');
            if (is_string($name) && trim($name) === '') {
                $validator->errors()->add('name', 'اسم المتجر لا يمكن أن يكون فارغاً أو بياضاً فقط.');
            }
        });
    }

    public function normalizedName(): string
    {
        return trim((string) $this->validated('name'));
    }

    public function locale(): string
    {
        return (string) ($this->validated('default_locale') ?: 'ar');
    }
}
