<?php

namespace App\Http\Requests;

/**
 * H6 Batch H — store-host buyer registration: the shared customer rules plus an optional locale path prefix
 * (`/xx/yy`) that only shapes the e-mailed link's path. The link's host is never taken from the request.
 */
class BuyerRegisterRequest extends CustomerRegisterRequest
{
    public function rules(): array
    {
        return array_merge(parent::rules(), [
            'locale_path' => ['sometimes', 'nullable', 'string', 'regex:#^/[a-z]{2}/[a-z]{2}$#'],
        ]);
    }
}
