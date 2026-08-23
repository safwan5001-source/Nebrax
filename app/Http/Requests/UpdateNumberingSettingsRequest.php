<?php

namespace App\Http\Requests;

use App\Support\DocumentNumberingCatalog;
use Illuminate\Foundation\Http\FormRequest;

class UpdateNumberingSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'entity'     => ['required', 'in:' . implode(',', DocumentNumberingCatalog::editableKeys())],
            'series_key' => ['required', 'string', 'max:64', 'regex:/^[a-z0-9_]+$/'],
            // البادئة واللاحقة تدخلان رقم المستند مباشرة: حروف وأرقام وشرطة فقط.
            'prefix'     => ['nullable', 'string', 'max:20', 'regex:/^[A-Za-z0-9-]*$/'],
            'suffix'     => ['nullable', 'string', 'max:20', 'regex:/^[A-Za-z0-9-]*$/'],
        ];
    }

    public function messages(): array
    {
        return [
            'entity.in'      => 'نوع المستند غير صالح.',
            'series_key.regex'=> 'سلسلة الترقيم غير صالحة.',
            'prefix.regex'   => 'بادئة الترقيم تقبل الحروف اللاتينية والأرقام والشرطة فقط.',
            'suffix.regex'   => 'لاحقة الترقيم تقبل الحروف اللاتينية والأرقام والشرطة فقط.',
        ];
    }
}
