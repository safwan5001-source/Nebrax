<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** موافقة مالك المؤسسة على تنفيذ AI Actions (IMP-X-01c) — عقد مغلق: `approved` وحده. الصلاحية في المسار ودور المالك في الخدمة. */
class AiActionExecutionApprovalRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return ['approved' => ['required', 'boolean']];
    }

    /** @return array<int,callable> */
    public function after(): array
    {
        return [function ($validator): void {
            foreach (array_diff(array_keys($this->request->all()), ['approved']) as $unknown) {
                $validator->errors()->add((string) $unknown, 'حقل غير مسموح.');
            }
        }];
    }
}
