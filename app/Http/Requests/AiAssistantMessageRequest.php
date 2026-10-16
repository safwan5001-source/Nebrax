<?php

namespace App\Http\Requests;

use App\Support\AiAssistantDataCategory;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * طلب رسالة للمساعد الذكي — عقد مغلق ومحدود.
 *
 * أي حقل خارج القائمة يُرفض صراحةً (لا يُتجاهَل): لا `tenant_id` ولا `user_id` ولا
 * `provider`/`model` ولا `tools`/`sql`/`url` من العميل. الصلاحية تُفرض في المسار
 * وفي البوابة، لا هنا.
 *
 * ترتيب موثَّق: هذا التحقق من الشكل يعمل **قبل** مفتاح الإيقاف، فالطلب المشوَّه يعود 422
 * حتى والمنصة معطّلة. آمن عمداً: لا يُعالَج شيء ولا تُقرأ سياسة ولا يُدقَّق، والردّ
 * لا يختلف بحالة المفتاح (يثبّته اختبار). مفتاح الإيقاف يحكم كل طلب صالح الشكل.
 */
class AiAssistantMessageRequest extends FormRequest
{
    private const TOP_LEVEL = ['message', 'locale', 'data_categories', 'scope'];

    private const SCOPE_KEYS = ['branch_ids', 'warehouse_ids'];

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $maxChars = (int) config('ai_assistant.limits.message_max_chars', 2000);
        $maxIds = (int) config('ai_assistant.limits.scope_max_ids', 10);

        return [
            'message' => ['required', 'string', 'max:' . $maxChars, 'not_regex:/[\x00-\x08\x0B\x0C\x0E-\x1F]/'],
            'locale' => ['sometimes', 'string', Rule::in(['ar', 'en'])],
            'data_categories' => ['sometimes', 'array', 'min:1', 'max:' . count(AiAssistantDataCategory::ALL)],
            'data_categories.*' => ['string', 'distinct', Rule::in(AiAssistantDataCategory::ALL)],
            'scope' => ['sometimes', 'array'],
            'scope.branch_ids' => ['sometimes', 'array', 'max:' . $maxIds],
            'scope.branch_ids.*' => ['string', 'uuid', 'distinct'],
            'scope.warehouse_ids' => ['sometimes', 'array', 'max:' . $maxIds],
            'scope.warehouse_ids.*' => ['string', 'uuid', 'distinct'],
        ];
    }

    /** @return array<int, callable> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            foreach (array_diff(array_keys($this->all()), self::TOP_LEVEL) as $field) {
                $validator->errors()->add((string) $field, 'unsupported_field');
            }

            $key = $this->header('Idempotency-Key');
            if ($key !== null && preg_match('/^[A-Za-z0-9._:-]{8,64}$/', $key) !== 1) {
                $validator->errors()->add('Idempotency-Key', 'invalid_idempotency_key');
            }

            $scope = $this->input('scope');
            if (is_array($scope)) {
                foreach (array_diff(array_keys($scope), self::SCOPE_KEYS) as $field) {
                    $validator->errors()->add('scope.' . $field, 'unsupported_field');
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
