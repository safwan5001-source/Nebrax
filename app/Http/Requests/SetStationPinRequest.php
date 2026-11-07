<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** تعيين PIN لموظف: `pin` اختياري (غيابه = توليد عشوائي)، و`reason` اختياري للتدقيق. */
class SetStationPinRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'pin' => ['nullable', 'string', 'max:32'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }
}
