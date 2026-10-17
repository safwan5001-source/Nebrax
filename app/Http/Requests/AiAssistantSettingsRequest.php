<?php

namespace App\Http\Requests;

use App\Support\AiAssistantDataCategory;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * تحديث موافقة المؤسسة على المساعد (AI-03) — عقد مغلق: `enabled`، `consented_categories`، `acknowledge_privacy`.
 * أي حقل آخر يُرفض (لا `tenant_id` ولا مفاتيح منصة ولا أسعار ولا ميزانيات). الصلاحية `ai.consent.manage` تُفرض في المسار.
 */
class AiAssistantSettingsRequest extends FormRequest
{
    private const ALLOWED = ['enabled', 'consented_categories', 'acknowledge_privacy', 'acknowledge_external_provider'];

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            'enabled' => ['required', 'boolean'],
            'consented_categories' => ['present', 'array', 'max:' . count(AiAssistantDataCategory::ALL)],
            'consented_categories.*' => ['string', 'distinct', Rule::in(AiAssistantDataCategory::ALL)],
            'acknowledge_privacy' => ['sometimes', 'boolean'],
            'acknowledge_external_provider' => ['sometimes', 'boolean'],
        ];
    }

    /** @return array<int,callable> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            foreach (array_diff(array_keys($this->all()), self::ALLOWED) as $field) {
                $validator->errors()->add((string) $field, 'unsupported_field');
            }
            // فئة معروفة لكنها غير متاحة بعد (نصّ المستند — AI-04): تُحجب صراحةً لا بصمت.
            foreach ((array) $this->input('consented_categories', []) as $index => $category) {
                if (is_string($category) && AiAssistantDataCategory::isKnown($category) && ! AiAssistantDataCategory::isAvailable($category)) {
                    $validator->errors()->add("consented_categories.{$index}", 'category_unavailable');
                }
            }
        }];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->json([
            'error' => [
                'code' => 'invalid_request',
                'message' => 'الطلب غير صالح.',
                'fields' => $validator->errors()->toArray(),
            ],
            'request_id' => (string) Str::uuid(),
        ], 422));
    }
}
