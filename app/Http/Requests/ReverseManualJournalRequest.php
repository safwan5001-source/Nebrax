<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ReverseManualJournalRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'entry_date' => ['nullable', 'date'],
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ];
    }
}
