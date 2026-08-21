<?php

namespace App\Http\Requests;

use App\Models\PlatformSubscription;
use App\Support\Plans;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PlatformSubscriptionStoreRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'plan'               => ['required', 'string', Rule::in(array_keys(Plans::PLANS))],
            'currency'           => ['required', 'string', 'size:3', Rule::in([PlatformSubscription::CURRENCY_SAR])],
            'status'             => ['sometimes', 'string', Rule::in([PlatformSubscription::STATUS_ACTIVE, PlatformSubscription::STATUS_TRIAL])],
            'starts_on'          => ['required', 'date'],
            'ends_on'            => ['nullable', 'date', 'after_or_equal:starts_on'],
            'external_reference' => ['nullable', 'string', 'max:255'],
            'reason'             => ['nullable', 'string', 'max:1000'],
        ];
    }
}
