<?php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/** AWJ-MULTI-STORE-1 — لا يقبل أي هوية تقنية أو tenant_id من العميل. */
class CreateStorefrontRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'default_locale' => ['sometimes', 'nullable', 'string', 'in:ar,en'],
            // B2C-DEFAULT: غيابه/null = تُفعَّل حسابات العملاء للمتجر الجديد؛ false الصريح يُحترم.
            'customer_accounts_enabled' => ['sometimes', 'nullable', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $name = $this->input('name');
            if (is_string($name) && trim($name) === '') {
                $validator->errors()->add('name', 'اسم المتجر لا يمكن أن يكون فارغاً أو بياضاً فقط.');
            }
        });
    }

    public function normalizedName(): string
    {
        return trim((string) $this->validated('name'));
    }

    /** `null` = لم يُرسَل ⇒ الافتراضي (مفعَّلة)؛ قيمة منطقية صريحة تُحترم كما أُرسلت. */
    public function customerAccountsEnabled(): ?bool
    {
        $value = $this->validated('customer_accounts_enabled');

        return $value === null ? null : (bool) $value;
    }

    public function locale(): string
    {
        return (string) ($this->validated('default_locale') ?: 'ar');
    }
}
