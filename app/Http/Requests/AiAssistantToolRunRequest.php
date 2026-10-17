<?php

namespace App\Http\Requests;

use App\Services\AiAssistantToolRegistry;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * تشغيل صريح لأداة مالية للقراءة فقط من المستخدم (AI-03). الأداة تُختار من **السجل المغلق** وحده،
 * والمعطيات تتحقق منها الأداة نفسها بمخططها المغلق؛ هنا تحقق الشكل فقط. لا `tenant_id` ولا مزوّد ولا SQL.
 */
class AiAssistantToolRunRequest extends FormRequest
{
    private const TOP_LEVEL = ['tool', 'arguments', 'scope'];

    private const SCOPE_KEYS = ['branch_ids', 'warehouse_ids'];

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        $maxIds = (int) config('ai_assistant.limits.scope_max_ids', 10);

        return [
            'tool' => ['required', 'string', Rule::in(app(AiAssistantToolRegistry::class)->names())],
            'arguments' => ['required', 'array', 'max:5'],
            'arguments.*' => ['nullable', 'string', 'max:32'],
            'scope' => ['sometimes', 'array'],
            'scope.branch_ids' => ['sometimes', 'array', 'max:' . $maxIds],
            'scope.branch_ids.*' => ['string', 'uuid', 'distinct'],
            'scope.warehouse_ids' => ['sometimes', 'array', 'max:' . $maxIds],
            'scope.warehouse_ids.*' => ['string', 'uuid', 'distinct'],
        ];
    }

    /** @return array<int,callable> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            foreach (array_diff(array_keys($this->all()), self::TOP_LEVEL) as $field) {
                $validator->errors()->add((string) $field, 'unsupported_field');
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
