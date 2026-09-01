<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * تمثيل الطرف في الـ Public API — عقد مُنتقى ومستقر، لا نموذج Eloquent مباشر.
 *
 * يستبعد الداخليّ والحسّاس: التصنيفات التحليلية، قوائم الأسعار، حدّ/مدة الائتمان،
 * ومعرّفات المستأجر/الفرع. `id` مكشوف للإشارة إلى المورد.
 */
class PublicPartnerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'          => $this->id,
            'code'        => $this->code,
            'type'        => $this->type,        // customer | supplier | both
            'entity_type' => $this->entity_type, // commercial | individual …
            'name'        => $this->name,
            'name_en'     => $this->name_en,
            'vat_number'  => $this->vat_number,
            'cr_number'   => $this->cr_number,
            'email'       => $this->email,
            'phone'       => $this->phone,
            'mobile'      => $this->mobile,
            'address'     => [
                'address'     => $this->address,
                'city'        => $this->city,
                'district'    => $this->district,
                'street'      => $this->street,
                'building_no' => $this->building_no,
                'postal_code' => $this->postal_code,
                'country'     => $this->country,
            ],
            'is_active'   => (bool) $this->is_active,
            'created_at'  => $this->created_at?->toIso8601String(),
            'updated_at'  => $this->updated_at?->toIso8601String(),
        ];
    }
}
