<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** إعادة إسناد المشغّل. المستأجر من الجلسة، ولا يحمل السر. */
class ReassignDeliveryConnectorOperatorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'user_id' => ['required', 'uuid'],
        ];
    }
}
