<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator as ValidatorContract;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;

/**
 * AWJ-VD-H1 / VD-1b (§3.8-a) — body of `PUT …/facets/{id}/visual` and `PUT …/facets/{id}/values/{valueId}/visual`:
 * `{visual: object|null, expected_version: int|null}`, read from the **JSON body only**.
 *
 * - No authority field is accepted (tenant, owner ids and version come from the route and the stored row); unknown
 *   body keys and any query-string parameter are a 422.
 * - `expected_version` must be a JSON integer ≥ 1: `true`, `1.0` or `"1"` never satisfy the concurrency token (D-17).
 * - `visual` is taken from the raw JSON, so `""` stays a 422 instead of becoming `null` (the "remove identity" path)
 *   through the global empty-string middleware. The document itself is validated by `CommerceFacetVisualService`.
 * - Every 422 carries `code: visual_invalid`, like the service's field errors.
 */
class SaveCommerceFacetVisualRequest extends FormRequest
{
    public const ALLOWED_KEYS = ['visual', 'expected_version'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'visual' => ['present'],
            'expected_version' => ['nullable', static function (string $attribute, mixed $value, \Closure $fail): void {
                if (! is_int($value) || $value < 1) {
                    $fail('expected_version يجب أن يكون عدداً صحيحاً موجباً أو null.');
                }
            }],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function () {
            if ($this->query() !== []) {
                throw ValidationException::withMessages(['request' => 'لا تُقبل معاملات في رابط الطلب.']);
            }

            $decoded = $this->body();
            if ($decoded === null) {
                throw ValidationException::withMessages(['request' => 'جسم الطلب يجب أن يكون كائناً JSON.']);
            }

            $unknown = array_values(array_diff(array_keys($decoded), self::ALLOWED_KEYS));
            if ($unknown !== []) {
                throw ValidationException::withMessages(['request' => 'حقول غير مسموحة: '.implode(', ', $unknown)]);
            }
        });
    }

    /** The raw JSON value: `{}` decodes to `[]` (the empty document); a JSON list or `""` stays a 422 downstream. */
    public function visual(): mixed
    {
        return $this->body()['visual'] ?? null;
    }

    public function expectedVersion(): ?int
    {
        $version = $this->body()['expected_version'] ?? null;

        return is_int($version) ? $version : null;
    }

    protected function failedValidation(ValidatorContract $validator): void
    {
        throw new HttpResponseException(response()->json([
            'message' => $validator->errors()->first(),
            'code' => 'visual_invalid',
            'errors' => $validator->errors()->toArray(),
        ], 422));
    }

    /** @return array<string, mixed>|null the decoded JSON object, or null when the body is not one */
    private function body(): ?array
    {
        $decoded = json_decode((string) $this->getContent(), true);

        return is_array($decoded) && ($decoded === [] || ! array_is_list($decoded)) ? $decoded : null;
    }
}
