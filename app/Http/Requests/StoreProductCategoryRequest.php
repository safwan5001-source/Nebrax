<?php

namespace App\Http\Requests;

use App\Models\ProductCategory;
use Illuminate\Foundation\Http\FormRequest;

class StoreProductCategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'         => ['required', 'string', 'max:255'],
            'description'  => ['nullable', 'string', 'max:4000'],
            'parent_id'    => ['nullable', 'uuid'],
            'is_active'    => ['nullable', 'boolean'],
            'image'        => ['nullable', 'file', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
            'remove_image' => ['nullable', 'boolean'],
            // PR-2C: بيانات عرض للعميل لا هوية AWJ — `#RRGGBB` صارم فقط، فلا
            // تمرّ دالة CSS ولا متغيّر ولا نص حرّ إلى الاستجابة أو أي ورقة أنماط.
            'color'        => ['nullable', 'string', 'regex:' . ProductCategory::COLOR_REGEX],
        ];
    }
}
