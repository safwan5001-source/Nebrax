<?php

namespace App\Http\Requests;

use App\Services\Accounting\ZatcaCredentialService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateZatcaCredentialRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->merge(['environment' => $this->route('environment')]);
    }

    public function rules(): array
    {
        return [
            'environment' => ['required', Rule::in(ZatcaCredentialService::ENVIRONMENTS)],
            'stage' => ['required', Rule::in(ZatcaCredentialService::STAGES)],
            'binary_security_token' => ['nullable', 'string', 'max:20000'],
            'secret' => ['nullable', 'string', 'max:4000'],
            'private_key' => ['nullable', 'string', 'max:20000'],
            'request_id' => ['nullable', 'string', 'max:255'],
            'expires_at' => ['nullable', 'date'],
            'current_password' => ['required', 'string', 'max:255'],
        ];
    }
}
