<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * إنشاء متغيّرات من تركيبات مراجَعة صراحةً — لا Cartesian صامت. كل عنصر في
 * `combinations` قائمة معرّفات قيم خيارٍ واحدة لكل خيار فعّال في المنتج؛
 * التحقق من ملكيتها والتغطية الكاملة مسؤولية `ProductVariantService`.
 */
class CreateProductVariantsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'combinations' => ['required', 'array', 'min:1', 'max:500'],
            'combinations.*' => ['required', 'array', 'min:1'],
            'combinations.*.*' => ['required', 'uuid'],
        ];
    }
}
