<?php

namespace App\Http\Resources;

use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Route as RouteFacade;

/**
 * Public storefront catalog — تمثيل منتج للقراءة العامة المجهولة. قائمة سماح
 * صريحة (لا تمرير نموذج مباشر): **ممنوع** أي حقل تكلفة/هامش/حساب داخلي أو
 * كمية مخزون خام — انظر استثناءات `PublicProductResource` نفسها؛ هذا المورد
 * يضيف فقط ما يحتاجه المتصفح المجهول (سعر مُحلَّل، توفر مشتقّ، وسائط، تصنيف).
 *
 * السعر والتوفر يُحسبان في المتحكّم (`CommercePriceResolver`/`AvailableToSellService`
 * أو نظيرهما المجمّع) لا هنا — هذا المورد عرضٌ فقط.
 *
 * `tenantSlug`: **اختياري** — غير `null` فقط على المسار المتوارَث
 * (`{tenantSlug}/...`، COM-7-P1)؛ `null` على المسار الموثوق (COM-7-P2A) الذي
 * يحسم المستأجر من الـ Host بلا شريحة رابط. `mediaUrl()` تبني الرابط من
 * اسم المسار المناسب تبعاً لذلك — لا افتراض لمسار واحد.
 */
class StorefrontProductResource extends JsonResource
{
    public function __construct(
        Product $resource,
        private readonly int $priceAmountMinor,
        private readonly string $currency,
        private readonly ?bool $inStock,
        private readonly bool $detailed,
        private readonly ?string $tenantSlug,
    ) {
        parent::__construct($resource);
    }

    public function toArray(Request $request): array
    {
        $media = $this->resource->relationLoaded('media') ? $this->resource->media : collect();
        $thumbnail = $media->first();

        return [
            'id' => $this->resource->id,
            'name' => $this->resource->name,
            'name_en' => $this->resource->name_en,
            'description' => $this->resource->description,
            'sku' => $this->resource->sku,
            'category' => $this->resource->relationLoaded('productCategory') && $this->resource->productCategory
                ? [
                    'id' => $this->resource->productCategory->id,
                    'name' => $this->resource->productCategory->name,
                ]
                : null,
            'price' => [
                'amount_minor' => $this->priceAmountMinor,
                'currency' => $this->currency,
            ],
            'in_stock' => $this->inStock,
            'thumbnail_url' => $thumbnail ? $this->mediaUrl($thumbnail->id) : null,
            'media' => $this->when(
                $this->detailed,
                fn () => $media->values()->map(fn ($item) => [
                    'id' => $item->id,
                    'url' => $this->mediaUrl($item->id),
                    'alt' => $item->original_name,
                    'position' => $item->sort_order,
                ])->all(),
            ),
            'created_at' => $this->resource->created_at?->toIso8601String(),
            'updated_at' => $this->resource->updated_at?->toIso8601String(),
        ];
    }

    private function mediaUrl(string $mediaId): string
    {
        if ($this->tenantSlug !== null) {
            return RouteFacade::has('storefront.v1.legacy.media.show')
                ? route('storefront.v1.legacy.media.show', ['tenantSlug' => $this->tenantSlug, 'id' => $mediaId])
                : "/store/v1/{$this->tenantSlug}/media/{$mediaId}";
        }

        return RouteFacade::has('storefront.v1.media.show')
            ? route('storefront.v1.media.show', ['id' => $mediaId])
            : "/store/v1/media/{$mediaId}";
    }
}
