<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;

/**
 * AWJ-VD-H1 / VD-1b (§3.8-a) — body of `PUT …/facets/{id}/visual` and `PUT …/facets/{id}/values/{valueId}/visual`:
 * `{visual: object|null, expected_version: int|null}`. No authority field is accepted (tenant, owner ids and version
 * come from the route and the stored row); unknown keys are a 422. The visual document itself is validated by
 * `CommerceFacetVisualService` (field errors with stable codes).
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
            'expected_version' => ['nullable', 'integer', 'min:1'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function () {
            $decoded = json_decode((string) $this->getContent(), true);
            if ($decoded !== null && ! is_array($decoded)) {
                throw ValidationException::withMessages(['request' => 'جسم الطلب يجب أن يكون كائناً JSON.']);
            }

            $keys = is_array($decoded) ? array_keys($decoded) : array_keys($this->all());
            $unknown = array_values(array_diff($keys, self::ALLOWED_KEYS));
            if ($unknown !== []) {
                throw ValidationException::withMessages(['request' => 'حقول غير مسموحة: '.implode(', ', $unknown)]);
            }
        });
    }

    /** `{}` decodes to `[]`, which the normalizer accepts as the empty document; a JSON list stays a 422. */
    public function visual(): mixed
    {
        return $this->input('visual');
    }

    public function expectedVersion(): ?int
    {
        $version = $this->validated('expected_version');

        return $version === null ? null : (int) $version;
    }
}
