<?php

namespace App\Http\Requests;

use App\Support\UserRequestIdempotency;
use Illuminate\Foundation\Http\FormRequest;

class StoreAiActionApprovalRequest extends FormRequest
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
            'preview_id' => ['required', 'string', 'max:64'],
            'preview_hash' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/'],
            // The explicit confirmation the UI collects next to the preview identity.
            'acknowledged' => ['required', 'accepted'],
        ];
    }
}
