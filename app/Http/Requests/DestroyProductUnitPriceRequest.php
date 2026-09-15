<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * VAR-PRICE-UX-1/GAP-02: مسح سعرٍ صريح — «لا سعر» بعدها، لا صفرٌ ضمني.
 * الهويّة (وحدة + متغيّرٌ اختياري) تصل عبر معطيات الطلب (query أو body)،
 * إذ لا معرّف صفٍّ واحد يعرفه العميل بالضرورة سلفاً.
 */
class DestroyProductUnitPriceRequest extends FormRequest
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
        ];
    }
}
