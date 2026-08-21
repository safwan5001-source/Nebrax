<?php

namespace App\Http\Requests;

use App\Models\PlatformSubscription;
use App\Support\Plans;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PlatformPriceVersionStoreRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'plan'           => ['required', 'string', Rule::in(array_keys(Plans::PLANS))],
            'currency'       => ['required', 'string', 'size:3', Rule::in([PlatformSubscription::CURRENCY_SAR])],
            'monthly_amount' => ['required', 'integer', 'min:0'],
            'effective_on'   => ['required', 'date'],
        ];
    }
}
