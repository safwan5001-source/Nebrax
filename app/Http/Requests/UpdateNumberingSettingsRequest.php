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
            // الكيانات غير المضبوطة تُرفض هنا لا تُتجاهَل: طلبٌ يضبط بادئةً
            // ثابتةً في الكود يجب أن يفشل صراحةً، لا أن ينجح بلا أثر.
            'entity' => ['required', 'in:' . implode(',', DocumentNumberingCatalog::editableKeys())],
            // البادئة تدخل رقم المستند مباشرةً: حروف وأرقام وشرطة فقط، بلا
            // مسافات ولا رموز — الرقم مُعرّف يُطبع ويُبحث به لا نصّ حرّ.
            'prefix' => ['nullable', 'string', 'max:10', 'regex:/^[A-Za-z0-9-]+$/'],
        ];
    }

    public function messages(): array
    {
        return [
            'entity.in'     => 'هذا النوع بادئتُه ثابتة في النظام ولا تُضبط من الإعدادات.',
            'prefix.regex'  => 'بادئة الترقيم تقبل الحروف اللاتينية والأرقام والشرطة فقط.',
        ];
    }
}
