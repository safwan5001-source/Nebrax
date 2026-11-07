<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** دخول تطبيق المحطات: رقم الموظف + PIN. الشكل فقط هنا؛ الحكم على الصحة في `StationPinCredentialService`. */
class StationLoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'employee_no' => ['required', 'string', 'max:64'],
            'pin' => ['required', 'string', 'max:32'],
        ];
    }
}
