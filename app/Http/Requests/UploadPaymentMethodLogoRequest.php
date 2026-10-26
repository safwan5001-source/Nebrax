<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UploadPaymentMethodLogoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** PNG/JPEG/WebP فقط؛ SVG مرفوض عمداً (لا تعقيم له في خط التخزين الحالي). */
    public function rules(): array
    {
        return [
            'logo' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:1024', 'dimensions:max_width=2000,max_height=2000'],
        ];
    }
}
