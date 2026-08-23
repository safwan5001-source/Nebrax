<?php

namespace App\Http\Requests;

use App\Models\FuelAviIdentityTag;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateFuelAviIdentityTagRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'status' => ['sometimes', 'string', Rule::in(FuelAviIdentityTag::STATUSES)],
            'effective_from' => ['sometimes', 'date'],
            'effective_until' => ['nullable', 'date'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
