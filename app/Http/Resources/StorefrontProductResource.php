<?php

namespace App\Http\Resources;

use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Route as RouteFacade;
use Illuminate\Support\Facades\URL;

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

    /** @var array<int, array<string, mixed>> FLOWERS-H4a / ADR-16 — مُدخَلات التخصيص النشطة (تفصيل فقط). */
    private array $personalization = [];

    /**
     * يُلحق تعريفات التخصيص النشطة. تظهر في التفصيل **فقط حين توجد** — منتج بلا تعريفات
     * بشكلٍ مطابق حرفياً لما قبل H4.
     *
     * @param  array<int, array<string, mixed>>  $fields
     */
    public function withPersonalization(array $fields): static
    {
        $this->personalization = $fields;

        return $this;
    }

    /** @var array<int, array<string, mixed>> FLOWERS-H5 / ADR-17 — كتل المحتوى النشطة (تفصيل فقط). */
    private array $contentBlocks = [];

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     */
    public function withContentBlocks(array $blocks): static
    {
        $this->contentBlocks = $blocks;

        return $this;
    }

    /** @var array<int, array<string, mixed>> FLOWERS-H6 / ADR-18 — الإضافات المتاحة (تفصيل فقط). */
    private array $addons = [];

    /**
     * @param  array<int, array<string, mixed>>  $addons
     */
    public function withAddons(array $addons): static
    {
        $this->addons = $addons;

        return $this;
    }

    /** @var ?array<string, mixed> FLOWERS-H8 / ADR-20 — وعد التسليم المشتق (قائمة وتفصيل)؛ null = لا مفتاح. */
    private ?array $deliveryPromise = null;

    /** @param  ?array<string, mixed>  $promise */
    public function withDeliveryPromise(?array $promise): static
    {
        $this->deliveryPromise = $promise;

        return $this;
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
            // Additive: catalogue cards can prefer this bounded derivative
            // while historical thumbnail_url remains the original media URL.
            'card_url' => $thumbnail['card_url'] ?? null,
            'media' => $this->when($this->detailed, fn () => $this->galleryMedia),
            'is_variant_managed' => $this->resource->isVariantManaged(),
            'options' => $this->when($this->options !== null, fn () => $this->options),
            'variants' => $this->when($this->variants !== null, fn () => $this->variants),
            'content_blocks' => $this->when($this->detailed && $this->contentBlocks !== [], fn () => $this->contentBlocks),
            'personalization' => $this->when($this->detailed && $this->personalization !== [], fn () => ['fields' => $this->personalization]),
            'addons' => $this->when($this->detailed && $this->addons !== [], fn () => $this->addons),
            'delivery_promise' => $this->when($this->deliveryPromise !== null, fn () => $this->deliveryPromise),
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
     * @return array<int, array{id:string,url:string,thumbnail_url:string,card_url:string,alt:?string,position:?int}>
     */
    public static function mediaPayload(iterable $items, ?string $tenantSlug): array
    {
        return self::buildPayload(
            $items,
            fn (string $id) => self::buildMediaUrl($id, $tenantSlug),
            fn (string $id, string $derivative) => self::buildDerivativeUrl($id, $derivative, $tenantSlug),
        );
    }

    /**
     * **متعمَّدٌ نسبياً (بلا مخطّط/مضيف)** — AWJ-R2-5. الخادم الوحيد الذي يستدعي
     * `store/v1` إنتاجياً هو خادم Next.js نفسه (`storefrontFetch()`، لا متصفح
     * الزائر مباشرة — راجع تعليق `ResolveStorefrontDomain`)، فـ`$request->getHost()`
     * الذي يبنيه `route()` هنا يعكس دومًا مضيف Laravel/الـ API الداخلي (مثل
     * Railway) لا نطاق متجر الزائر العام (`{tenant}.store.awjdev.xyz`) الذي لا
     * يُخدَّم منه `store/v1` إطلاقاً. رابطٌ مطلَقٌ بهذا المضيف كان يعمل خطأً
     * بالصدفة فقط عبر `toRenderableMediaUrl()` في الواجهة (يعيد كتابته بمساره
     * فقط) — سلطة تعويضٍ هشّة في طبقة الاستهلاك لعيبٍ في طبقة الإنتاج، تنكسر
     * صامتةً لأي مستهلكٍ مستقبلي (بريد، معاينة رابط، تصدير) لا يمرّ عبرها.
     * رابطٌ نسبي يُزيل الاعتماد على مضيف الطلب كليةً؛ لا تغيير في السلوك على
     * `toRenderableMediaUrl()` نفسها (`new URL(url, base)` يحسم المسار سواءً
     * كان الرابط مطلقاً أو نسبياً) ولا على `/commerce/v1` (تطبيقٌ جوّالٌ يحتاج
     * رابطاً مطلقاً فعلاً — `buildCommerceMediaUrl()` أدناه لا يتأثر).
     */
    public static function buildMediaUrl(string $mediaId, ?string $tenantSlug): string
    {
        if ($tenantSlug !== null) {
            return RouteFacade::has('storefront.v1.legacy.media.show')
                ? route('storefront.v1.legacy.media.show', ['tenantSlug' => $tenantSlug, 'id' => $mediaId], false)
                : "/store/v1/{$tenantSlug}/media/{$mediaId}";
        }

        return RouteFacade::has('storefront.v1.media.show')
            ? route('storefront.v1.media.show', ['id' => $mediaId], false)
            : "/store/v1/media/{$mediaId}";
    }

    public static function buildDerivativeUrl(string $mediaId, string $derivative, ?string $tenantSlug): string
    {
        if ($tenantSlug !== null) {
            return RouteFacade::has('storefront.v1.legacy.media.derivative.show')
                ? route('storefront.v1.legacy.media.derivative.show', ['tenantSlug' => $tenantSlug, 'id' => $mediaId, 'derivative' => $derivative], false)
                : "/store/v1/{$tenantSlug}/media/{$mediaId}/derivatives/{$derivative}";
        }

        return RouteFacade::has('storefront.v1.media.derivative.show')
            ? route('storefront.v1.media.derivative.show', ['id' => $mediaId, 'derivative' => $derivative], false)
            : "/store/v1/media/{$mediaId}/derivatives/{$derivative}";
    }

    /**
     * COM-MOBILE-MEDIA-1 — نظير `mediaPayload()` لحدّ ثقة `/commerce/v1`
     * الموثوق (bearer + قناة جوال محلولة، لا شريحة/نطاق متجر) — يبنيه
     * `CommerceProductController`. لا `tenantSlug` هنا أصلاً: المسار الموثوق
     * يحسم المستأجر من عميل الـ API، لا من الرابط.
     *
     * @param  iterable<\App\Models\ProductMedia>  $items
     * @return array<int, array{id:string,url:string,alt:?string,position:?int}>
     */
    public static function commerceMediaPayload(iterable $items): array
    {
        return self::buildPayload($items, fn (string $id) => self::buildCommerceMediaUrl($id));
    }

    public static function buildCommerceMediaUrl(string $mediaId): string
    {
        return RouteFacade::has('commerce.v1.media.show')
            ? route('commerce.v1.media.show', ['id' => $mediaId])
            : "/commerce/v1/media/{$mediaId}";
    }

    /**
     * CUST-H4-8b — نظير `commerceMediaPayload()` لحمولة **مساحة عمل** Commerce
     * (Canvas: وصل حديثاً/مميّزة/عروض)، لا حدّ ثقة الجوال. `/commerce/v1/media`
     * محروسٌ بـ`bearer` لا يستطيع `<img>` عادي في متصفح التاجر تزويده —
     * (CUST-H4-8 §15، B1). يبني رابطاً موقَّعاً قصير الأجل
     * (`buildWorkspaceMediaUrl()`) يخدمه `CommerceWorkspaceMediaController`
     * بلا مصادقة Bearer على الإطلاق — التوقيع نفسه هو السلطة.
     *
     * @param  iterable<\App\Models\ProductMedia>  $items
     * @return array<int, array{id:string,url:string,alt:?string,position:?int}>
     */
    public static function workspaceMediaPayload(iterable $items, string $storefrontId): array
    {
        return self::buildPayload($items, fn (string $id) => self::buildWorkspaceMediaUrl($id, $storefrontId));
    }

    /**
     * رابطٌ موقَّعٌ (`URL::temporarySignedRoute`) لا يُولَّد إلا من داخل سياقٍ
     * مُصادَقٍ بالكامل (`commerce.manage` + `ownedStorefront()`) — المُستدعي
     * مسؤولٌ عن ذلك، هذا البانى مجرّد تركيب رابط. مدّة قصيرة (دقائق) تحدّ
     * التعرّض: كل تحميل قائمةٍ جديد من التاجر يُصدِر روابط جديدة، فلا حاجة
     * لرابطٍ طويل الأجل لصورةٍ واحدة.
     */
    public static function buildWorkspaceMediaUrl(string $mediaId, string $storefrontId): string
    {
        return URL::temporarySignedRoute(
            'commerce.workspace.media.show',
            now()->addMinutes(20),
            ['id' => $storefrontId, 'media' => $mediaId],
        );
    }

    /**
     * @param  iterable<\App\Models\ProductMedia>  $items
     * @return array<int, array{id:string,url:string,thumbnail_url?:string,card_url?:string,alt:?string,position:?int}>
     */
    private static function buildPayload(iterable $items, callable $urlBuilder, ?callable $derivativeUrlBuilder = null): array
    {
        $out = [];
        foreach ($items as $item) {
            $entry = [
                'id' => $item->id,
                'url' => $urlBuilder($item->id),
                'alt' => $item->original_name,
                'position' => $item->sort_order,
            ];
            if ($derivativeUrlBuilder !== null) {
                $entry['thumbnail_url'] = $derivativeUrlBuilder($item->id, 'thumbnail');
                $entry['card_url'] = $derivativeUrlBuilder($item->id, 'card');
            }
            $out[] = $entry;
        }

        return $out;
    }
}
