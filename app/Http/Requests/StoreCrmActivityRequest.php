<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreCrmActivityRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'partner_id'  => ['nullable', 'uuid'],
            'type'        => ['nullable', 'in:call,meeting,email,note,task'],
            'subject'     => ['required', 'string', 'max:255'],
            'activity_at' => ['required', 'date'],
            'status'      => ['nullable', 'in:open,done'],
            'notes'       => ['nullable', 'string', 'max:1000'],
        ];
    }
}
