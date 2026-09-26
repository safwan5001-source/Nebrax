<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * VAR-OPTION-VISUAL-2B — رفع صورة صريّة (swatch) واحدة لقيمة خيارٍ قائمة.
 *
 * نفس حدود `StoreProductMediaRequest` القائمة حرفياً (٥ ميغا كحدٍّ أقصى،
 * jpg/jpeg/png/webp فقط — التحقق من MIME فعلياً في الخادم لا من اسم
 * الملف) لكن بملفٍّ واحدٍ لا مصفوفة: الصريّة عيّنةٌ واحدة مرجعُها الوحيد
 * `ProductOptionValue.image_media_id`، لا معرض.
 */
class StoreOptionValueSwatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'image' => ['required', 'file', 'max:5120', 'mimes:jpg,jpeg,png,webp'],
        ];
    }
}
