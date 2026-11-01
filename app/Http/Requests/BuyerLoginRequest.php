<?php

namespace App\Http\Requests;

/** B2C-ACCOUNTS — store-host login: the shared customer rules plus an optional "remember me" (persistent session). */
class BuyerLoginRequest extends CustomerLoginRequest
{
    public function rules(): array
    {
        return array_merge(parent::rules(), [
            'remember' => ['sometimes', 'boolean'],
        ]);
    }
}
