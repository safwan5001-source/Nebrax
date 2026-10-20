<?php

namespace App\Http\Requests;

use App\Services\AiActionRegistry;
use App\Support\UserRequestIdempotency;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreAiActionRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]);
    }

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'regex:'.UserRequestIdempotency::KEY_PATTERN],
            'type' => ['required', Rule::in([AiActionRegistry::PRODUCT_IMPORT])],
            'proposal' => ['required', 'array'],
        ];
    }
}
