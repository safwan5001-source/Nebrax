<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** AD-06 / S05c — جسم ترقية/تراجع النسخة الحيّة: كلاهما اختياري؛ `version_id` للتراجع فقط. */
class BuilderLivePointerActionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'reason' => ['nullable', 'string', 'max:500'],
            'version_id' => ['nullable', 'uuid'],
        ];
    }
}
