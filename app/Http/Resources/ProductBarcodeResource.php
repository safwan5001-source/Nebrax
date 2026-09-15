<?php

namespace App\Http\Resources;

use App\Support\DocumentLineVariantResolver;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductBarcodeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'unit_name' => $this->unit_name,
            'default_quantity' => (int) $this->default_quantity,
            'label' => $this->label,
            // VAR-PRICE-UX-1: إضافيّان — فارغان لمنتجٍ بسيط. الوصف يُشتقّ من
            // نفس سلطة اللقطة التاريخية (VAR-DOC-1) لا نسخة موازية، ولأنه
            // "حيّ" هنا (لا لقطة مستندٍ تاريخي) فهو يعكس الحالة الحالية للمتغيّر عمداً.
            'product_variant_id' => $this->product_variant_id,
            'variant_descriptor' => $this->product_variant_id !== null && $this->variant !== null
                ? DocumentLineVariantResolver::descriptor($this->variant)
                : null,
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
