<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreBuilderPublishedExperienceVersionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'note' => ['nullable', 'string', 'max:1000'],
            // AD-06 / S05c: «نشر وتفعيل» — يجعل النسخة الجديدة هي الحيّة في العملية نفسها (ذرّياً). افتراضه «نشر فقط».
            'promote' => ['nullable', 'boolean'],
            // AD-01 / S01d: اختياري (متوافق مع المستهلكين الحاليين). إن أُرسل فيجب أن يطابق revision المسودة وقت النشر وإلا 409.
            'expected_draft_revision' => [
                'nullable',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (is_bool($value)) {
                        $fail('expected_draft_revision يجب أن يكون عدداً صحيحاً.');
                    }
                },
                'integer',
                'min:0',
            ],
        ];
    }
}
