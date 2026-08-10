<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdatePurchaseSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'default_tax_rate'      => ['nullable', 'integer', 'min:0', 'max:100'],
            'default_payment_type'  => ['nullable', 'in:cash,credit'],
            'default_tax_inclusive' => ['nullable', 'boolean'],
            // البادئة تدخل رقم المستند مباشرةً: حروف وأرقام وشرطة فقط، بلا
            // مسافات ولا رموز — الرقم مُعرّف يُطبع ويُبحث به لا نصّ حرّ.
            'purchase_prefix'       => ['nullable', 'string', 'max:10', 'regex:/^[A-Za-z0-9-]+$/'],
        ];
    }

    public function messages(): array
    {
        return [
            'purchase_prefix.regex' => 'بادئة الترقيم تقبل الحروف اللاتينية والأرقام والشرطة فقط.',
        ];
    }
}
