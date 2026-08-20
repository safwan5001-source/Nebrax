<?php

namespace App\Http\Requests;

use App\Support\Plans;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * تعديل مستأجر من مساحة تشغيل المنصة: أي حقل من الثلاثة اختياري، لكن
 * الطلب يجب أن يحمل واحداً منها على الأقل.
 */
class PlatformTenantUpdateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'plan'          => ['sometimes', 'string', Rule::in(array_keys(Plans::PLANS))],
            'trial_ends_at' => ['sometimes', 'nullable', 'date'],
            'is_active'     => ['sometimes', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if (! $this->has('plan') && ! $this->has('trial_ends_at') && ! $this->has('is_active')) {
                $validator->errors()->add('plan', 'مرّر حقلاً واحداً على الأقل: plan أو trial_ends_at أو is_active.');
            }
        });
    }
}
