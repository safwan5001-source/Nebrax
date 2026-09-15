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
 * أو نظيرهما المجمّع) لا هنا — هذا المورد عرضٌ فقط. `media`/`variants` كذلك:
 * المتحكّم يبني كليهما عبر `ProductMediaGalleryService`/`CommercePriceResolver`
 * (VAR-MEDIA-1/VAR-PRICE-1) فتبقى سلطة الحلّ واحدة، لا نسخة موازية هنا.
 *
 * `tenantSlug`: **اختياري** — غير `null` فقط على المسار المتوارَث
 * (`{tenantSlug}/...`، COM-7-P1)؛ `null` على المسار الموثوق (COM-7-P2A) الذي
 * يحسم المستأجر من الـ Host بلا شريحة رابط. `mediaUrl()` تبني الرابط من
 * اسم المسار المناسب تبعاً لذلك — لا افتراض لمسار واحد.
 *
 * `variants`: **إضافيّ بحت** (VAR-COM-1) — `null` لمنتجٍ بسيط (لا تغيير في
 * الشكل القائم قبل هذا المعيار). لمنتجٍ متعدد الخيارات، مصفوفةٌ جاهزةٌ من
 * المتحكّم — كل عنصرٍ `{id, sku, descriptor, option_value_ids, price, in_stock, media}`.
 * `options`: بُعدا الاختيار (اللون/المقاس..) وقيمهما — لازمةٌ لواجهة الاختيار
 * قبل الإضافة للسلة (لا مسار بيعٍ غامض على الأب).
 */
class StorefrontProductResource extends JsonResource
{
    /**
     * @param  array<int, array{id:string,url:string,alt:?string,position:?int}>  $galleryMedia
     * @param  ?array<int, array{id:string,name:string,name_en:?string,values:array<int,array{id:string,value:string,value_en:?string}>}>  $options
     * @param  ?array<int, array{id:string,sku:?string,descriptor:?string,option_value_ids:array<int,string>,price:array{amount_minor:int,currency:string},in_stock:?bool,media:array<int,array{id:string,url:string,alt:?string,position:?int}>}>  $variants
     */
    public function __construct(
        Product $resource,
        private readonly int $priceAmountMinor,
        private readonly string $currency,
        private readonly ?bool $inStock,
        private readonly bool $detailed,
        private readonly ?string $tenantSlug,
        private readonly array $galleryMedia = [],
        private readonly ?array $options = null,
        private readonly ?array $variants = null,
    ) {
        parent::__construct($resource);
    }

    public function toArray(Request $request): array
    {
        $thumbnail = $this->galleryMedia[0] ?? null;

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
            'thumbnail_url' => $thumbnail['url'] ?? null,
            'media' => $this->when($this->detailed, fn () => $this->galleryMedia),
            'is_variant_managed' => $this->resource->isVariantManaged(),
            'options' => $this->when($this->options !== null, fn () => $this->options),
            'variants' => $this->when($this->variants !== null, fn () => $this->variants),
            'created_at' => $this->resource->created_at?->toIso8601String(),
            'updated_at' => $this->resource->updated_at?->toIso8601String(),
        ];
    }

    /**
     * يبني مصفوفة وسائط جاهزة للعرض من مجموعة `ProductMedia` محلولة عبر
     * `ProductMediaGalleryService` — يستهلكه المتحكّم لبناء `$galleryMedia`
     * الممرَّرة للمُنشئ، ولبناء وسائط كل متغيّرٍ في `$variants` أيضاً.
     *
     * @param  iterable<\App\Models\ProductMedia>  $items
     * @return array<int, array{id:string,url:string,alt:?string,position:?int}>
     */
    public static function mediaPayload(iterable $items, ?string $tenantSlug): array
    {
        $out = [];
        foreach ($items as $item) {
            $out[] = [
                'id' => $item->id,
                'url' => self::buildMediaUrl($item->id, $tenantSlug),
                'alt' => $item->original_name,
                'position' => $item->sort_order,
            ];
        }

        return $out;
    }

    public static function buildMediaUrl(string $mediaId, ?string $tenantSlug): string
    {
        if ($tenantSlug !== null) {
            return RouteFacade::has('storefront.v1.legacy.media.show')
                ? route('storefront.v1.legacy.media.show', ['tenantSlug' => $tenantSlug, 'id' => $mediaId])
                : "/store/v1/{$tenantSlug}/media/{$mediaId}";
        }

        return RouteFacade::has('storefront.v1.media.show')
            ? route('storefront.v1.media.show', ['id' => $mediaId])
            : "/store/v1/media/{$mediaId}";
    }
}
