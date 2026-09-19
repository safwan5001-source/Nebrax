<?php

namespace App\Http\Requests;

use App\Models\ProductOptionValue;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreProductOptionValueRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'value' => ['required', 'string', 'max:255'],
            'value_en' => ['nullable', 'string', 'max:255'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'is_active' => ['boolean'],
            // شكلٌ سطحي فقط هنا (تجربة مستخدمٍ أسرع) — التحقّق المُلزِم من
            // تطابق النوع مع الحقول المصاحبة (وربط الصورة بهذه القيمة بالذات)
            // في `ProductVariantService` حصراً، لا يُعتمَد على هذا وحده أبداً.
            'visual_type' => ['sometimes', 'nullable', Rule::in(ProductOptionValue::VISUAL_TYPES)],
            'color_value' => ['sometimes', 'nullable', 'string', 'max:7'],
            'image_media_id' => ['sometimes', 'nullable', 'uuid'],
        ];
    }
}
