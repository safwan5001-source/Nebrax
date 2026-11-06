<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ApproveFuelDeliveryRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'reason' => ['nullable', 'string', 'max:1000'],
            // FUEL-B5.1: التكلفة التي راجعها المعتمِد؛ تغيّرها قبل الاعتماد ⇒ 409. لا تُقبل إلا ممن يرى التكلفة (يفحصه المتحكّم) كي لا تصير قناة استدلال.
            'expected_total_cost_minor' => ['nullable', 'integer', 'min:1'],
        ];
    }
}
