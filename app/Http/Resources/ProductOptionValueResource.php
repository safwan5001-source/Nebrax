<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductOptionValueResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'product_option_id' => $this->product_option_id,
            'value' => $this->value,
            'value_en' => $this->value_en,
            'sort_order' => $this->sort_order,
            'is_active' => $this->is_active,
            // VAR-OPTION-VISUAL-1 — عميلٌ يتجاهل هذه الحقول يستمرّ بلا تغيير
            // (نصٌّ فقط، كما كان قبلها تماماً). `visual_type=none` هو المألوف.
            'visual_type' => $this->visual_type,
            'color_value' => $this->color_value,
            // لا مسار تخزينٍ داخليّ هنا أبداً — فقط معرّفٌ ورابط تنزيلٌ محروس،
            // بنفس عقد `ProductMediaResource` حرفياً (نفس مسار التنزيل
            // المشترك بين النطاقات الثلاث، `Product::allMedia()`).
            'image_media' => $this->when(
                $this->image_media_id !== null && $this->imageMedia !== null,
                fn () => [
                    'id' => $this->imageMedia->id,
                    'download_url' => "/api/products/{$this->imageMedia->product_id}/media/{$this->imageMedia->id}/download",
                ]
            ),
        ];
    }
}
