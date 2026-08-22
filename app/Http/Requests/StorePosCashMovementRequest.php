<?php

namespace App\Http\Requests;

use App\Models\PosCashMovement;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePosCashMovementRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type' => ['required', 'string', Rule::in(PosCashMovement::TYPES)],
            'amount' => ['required', 'integer', 'min:1'], // هللات
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ];
    }
}
