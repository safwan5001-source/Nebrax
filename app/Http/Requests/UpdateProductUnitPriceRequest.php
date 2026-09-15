<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * VAR-PRICE-UX-1/GAP-02: كتابة سعرٍ صريح لهويّةٍ (منتجٌ/متغيّرٌ فعلي) × وحدة.
 * تحقّقٌ بنيويّ فقط — `ProductPricingService::setPrice()` هو سلطة القرار
 * (انتماء المتغيّر، عزل المستأجر، القفل الذرّي).
 */
class UpdateProductUnitPriceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'unit_name' => ['nullable', 'string', 'max:255'],
            'product_variant_id' => ['nullable', 'uuid'],
            // بالهللات (minor units) — لا كسور عشرية إطلاقاً.
            'price' => ['required', 'integer', 'min:0', 'max:100000000000'],
        ];
    }
}
