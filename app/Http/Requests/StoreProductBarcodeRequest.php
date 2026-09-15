<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreProductBarcodeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:255'],
            'unit_name' => ['nullable', 'string', 'max:255'],
            'default_quantity' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'label' => ['nullable', 'string', 'max:255'],
            // VAR-PRICE-UX-1: تحقّقٌ بنيويّ فقط (nullable+uuid) — الانتماء
            // للمنتج نفسه وعزل المستأجر كلاهما سلطة حارس `ProductBarcode::booted()`
            // (`saving`)، لا هذا الطلب. راجع نمط VAR-FU-1 نفسه.
            'product_variant_id' => ['nullable', 'uuid'],
        ];
    }
}
