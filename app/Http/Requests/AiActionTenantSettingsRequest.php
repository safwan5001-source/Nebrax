<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** قبول المؤسسة لـAI Actions (IMP-H2-S4) — عقد مغلق: `enabled` وحده. الصلاحية `ai.actions.manage` تُفرض في المسار. */
class AiActionTenantSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return ['enabled' => ['required', 'boolean']];
    }

    /** @return array<int,callable> */
    public function after(): array
    {
        return [function ($validator): void {
            foreach (array_diff(array_keys($this->all()), ['enabled']) as $unknown) {
                $validator->errors()->add((string) $unknown, 'حقل غير مسموح.');
            }
        }];
    }
}
