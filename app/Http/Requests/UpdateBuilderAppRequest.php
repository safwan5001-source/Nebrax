<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** `creation_source` غير قابل للتعديل بعد الإنشاء — يصف كيفية نشأة التطبيق تاريخياً، لا حالة قابلة لإعادة الكتابة. */
class UpdateBuilderAppRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'name_en' => ['nullable', 'string', 'max:255'],
        ];
    }
}
