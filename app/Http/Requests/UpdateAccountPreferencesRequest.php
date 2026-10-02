<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateAccountPreferencesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'locale'    => ['required', 'string', Rule::in(['ar', 'en'])],
            'theme'     => ['required', 'string', Rule::in(['system', 'light', 'dark'])],
            // AWJ v3 theme (Default/Ink, Horizon 3) — independent of `theme` above
            // (Light/Dark). Optional so older/other API clients that only send
            // locale+theme keep working; the controller fills the stored default.
            'appTheme'  => ['sometimes', 'string', Rule::in(['default', 'ink'])],
        ];
    }
}
