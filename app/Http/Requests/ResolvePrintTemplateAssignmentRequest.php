<?php

namespace App\Http\Requests;

use App\Support\PrintTemplateContract;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * عقد قراءة التعيين الحي. يبقى حلّ أولوية الفرع في الخدمة، ولا يقبل هذا الطلب
 * نوع مستند أو استعمالاً خارج قائمة القوالب المصرّح بها.
 */
class ResolvePrintTemplateAssignmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'document_type' => ['required', 'string', Rule::in(PrintTemplateContract::DOCUMENT_TYPES)],
            'usage'         => ['sometimes', 'string', Rule::in(PrintTemplateContract::USAGES)],
            'branch_id'     => ['sometimes', 'nullable', 'uuid'],
        ];
    }
}
