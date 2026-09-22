<?php

namespace App\Http\Requests;

use App\Models\CommerceShippingZone;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCommerceShippingZoneRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'match_type' => ['required', Rule::in(CommerceShippingZone::MATCH_TYPES)],
            'match_value' => ['required', 'string', 'max:255'],
            // نفس السقف المستعمل لأي مبلغ بالهللات في طلبات مماثلة
            // (PublicStoreInvoiceRequest/PublicStoreProductRequest) — يمنع
            // فيضان bigint عند جمعه لاحقاً مع إجمالي الطلب.
            'rate_amount_minor' => ['required', 'integer', 'min:0', 'max:100000000000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
