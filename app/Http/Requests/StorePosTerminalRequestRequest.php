<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePosTerminalRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'pos_session_id' => ['required', 'uuid'],
            'pos_payment_terminal_id' => ['required', 'uuid'],
            'payment_method_id' => ['required', 'uuid'],
            'amount' => ['required', 'integer', 'min:1', 'max:100000000000'], // هللات
            'idempotency_key' => ['required', 'uuid'],
        ];
    }
}
