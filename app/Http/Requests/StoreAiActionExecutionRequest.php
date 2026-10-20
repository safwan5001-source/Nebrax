<?php

namespace App\Http\Requests;

use App\Support\UserRequestIdempotency;
use Illuminate\Foundation\Http\FormRequest;

class StoreAiActionExecutionRequest extends FormRequest
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
            'expected_version' => ['required', 'integer', 'min:1'],
        ];
    }
}
