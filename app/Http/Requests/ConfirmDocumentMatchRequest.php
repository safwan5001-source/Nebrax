<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ConfirmDocumentMatchRequest extends FormRequest
{
    public function authorize(): bool { return true; }
    public function rules(): array
    {
        return ['expected_version' => ['required', 'integer', 'min:1'], 'candidate_id' => ['required', 'uuid'], 'reason' => ['required', 'string', 'max:500']];
    }
}
