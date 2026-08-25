<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreDocumentReviewChangeRequest extends FormRequest
{
    public function authorize(): bool { return true; }
    public function rules(): array
    {
        return [
            'expected_version' => ['required', 'integer', 'min:1'],
            'target_key' => ['required', 'string', 'max:160'],
            'value' => ['required'],
            'reason' => ['required', 'string', 'max:500'],
        ];
    }
}
