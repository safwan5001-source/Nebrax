<?php

namespace App\Http\Requests;

use App\Support\DocumentNumberingCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

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
            // السلسلة صريحة للكيانات متعددة السلاسل؛ ذات السلسلة الوحيدة تحلها
            // من الكتالوج للمحافظة على عقد PUT السابق بلا مسار توليد موازٍ.
            'series_key' => ['nullable', 'string', 'max:64', 'regex:/^[a-z0-9_]+$/'],
            // البادئة واللاحقة تدخلان رقم المستند مباشرة: حروف وأرقام وشرطة فقط.
            'prefix'     => ['nullable', 'string', 'max:20', 'regex:/^[A-Za-z0-9-]*$/'],
            'suffix'     => ['nullable', 'string', 'max:20', 'regex:/^[A-Za-z0-9-]*$/'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $entity = $this->input('entity');
            if (! is_string($entity) || ! in_array($entity, DocumentNumberingCatalog::editableKeys(), true)) {
                return;
            }

            $seriesKey = $this->input('series_key');
            if ($seriesKey === null || $seriesKey === '') {
                if (DocumentNumberingCatalog::requiresExplicitSeriesKey($entity)) {
                    $validator->errors()->add('series_key', 'اختيار سلسلة الترقيم مطلوب لهذا النوع من المستندات.');
                }

                return;
            }

            if (! is_string($seriesKey) || ! DocumentNumberingCatalog::hasSeries($entity, $seriesKey)) {
                $validator->errors()->add('series_key', 'سلسلة الترقيم غير صالحة لهذا النوع من المستندات.');
            }
        });
    }

    public function messages(): array
    {
        return [
            'entity.in'       => 'نوع المستند غير صالح.',
            'series_key.regex'=> 'سلسلة الترقيم غير صالحة.',
            'prefix.regex'    => 'بادئة الترقيم تقبل الحروف اللاتينية والأرقام والشرطة فقط.',
            'suffix.regex'    => 'لاحقة الترقيم تقبل الحروف اللاتينية والأرقام والشرطة فقط.',
        ];
    }
}
