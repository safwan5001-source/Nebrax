<?php

namespace App\Services\Commerce;

use App\Models\CommerceListing;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\SalesChannel;
use App\Models\StorefrontOffer;
use App\Models\Tenant;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Storefront Offers — قراءة فقط (CUST-H4-6، H4-ARCH-1 §23.3)
 * ═══════════════════════════════════════════════════════════════
 *
 * سطح عرضٍ تسويقي فوق تسعيرٍ قائم، **لا سلطة سعر**. صفّ `storefront_offers`
 * مرشّحٌ فحسب؛ لا يظهر منتجٌ علناً إلا إن أثبت مسار التسعير القائم أن له
 * **خصماً حقيقياً الآن**، تعريفاً من دلالات التسعير الموجودة وحدها:
 *
 *   السعر المرجعي = `Product.sale_price` (السعر الأساسي العلني للمنتج)
 *   سعر العرض     = `CommercePriceResolver::resolve($product, $channel)` —
 *                   حرفياً الرقم الذي ستحاسب به سلة تجارة (Cart V1) زائراً
 *                   مجهولاً على هذه القناة (بلا عميل، وحدة الأساس).
 *   خصمٌ حقيقي   ⇔ سعر العرض محسومٌ و< السعر المرجعي (صارم). غير ذلك — سعرٌ
 *                   مساوٍ أو أعلى أو غير محسوم أو الحسم رمى — يُحجب (fail-closed).
 *
 * لا حساب خصمٍ هنا خارج هذا الحسم، ولا شيء يُخزَّن. الضريبة غائبة عمداً كما في
 * `CommercePriceResolver`. لا نسبة ولا وفر ولا سعر مشطوب: حسابُ الشارات مؤجَّلٌ
 * لـ H4-7 ويُبنى على الرقمين المُعادَين هنا.
 *
 * **منتجٌ متعدد الخيارات يُحجب دوماً** (`variant_managed`): لا سعر مرجعي ولا
 * سعر عرض للأب (`resolve()` يرفض `variantId = null` له فشلاً مغلَقاً)، واختيار
 * متغيّرٍ «ممثِّل» (الأرخص؟ الأول؟) أو عرض «ابتداءً من» قرارُ تسعيرٍ عرضي لم
 * يُعتمد — لا يُخترَع هنا. انظر تقرير H4-6 (مخاطر/تسليم H4-7).
 *
 * **الأداء**: استعلامٌ مجمّعٌ واحد لكل من المنتجات والنشر والصور، ثم مرحلتان
 * *ضروريتان* تتجاوزان استدعاء المُحلِّل حيث الجواب معروف سلفاً: (١) قناةٌ بلا
 * قائمة أسعار افتراضية ⇒ كل منتجٍ يُحسم بسعره الأساسي حتماً ⇒ لا خصم؛ (٢) منتجٌ
 * بلا عنصر صريح في تلك القائمة ⇒ كذلك. هذا تضييقٌ لا مصدرُ حقيقة: الرقمان
 * يأتيان من المُحلِّل لكل ناجٍ، والعدد محدودٌ بـ`MAX_OFFERS_PER_STOREFRONT`.
 * يتطلب سياق مستأجر نشطاً (نفس شرط `CommercePriceResolver`).
 */
final class StorefrontOfferResolver
{
    /** سقف مرشّحات العرض للمتجر الواحد — يحدّ تكلفة التسعير لكل قراءة. */
    public const MAX_OFFERS_PER_STOREFRONT = 12;

    public const REASON_INACTIVE = 'inactive';

    public const REASON_SCHEDULED = 'scheduled';

    public const REASON_EXPIRED = 'expired';

    public const REASON_PRODUCT_UNAVAILABLE = 'product_unavailable';

    public const REASON_VARIANT_MANAGED = 'variant_managed';

    public const REASON_NOT_DISCOUNTED = 'not_discounted';

    public const REASON_PRICE_UNRESOLVED = 'price_unresolved';

    public function __construct(private readonly CommercePriceResolver $prices) {}

    /**
     * القراءة العامة: العروض الحيّة الآن فقط، بترتيبٍ حتمي. نفس `evaluate()` الذي
     * تستعمله المساحة الإدارية — التكافؤ بنيويٌّ على مستوى الخدمة.
     *
     * @return list<StorefrontOfferView>
     */
    public function liveForStorefront(string $storefrontId, string $salesChannelId, ?CarbonInterface $now = null): array
    {
        $now ??= CarbonImmutable::now('UTC');

        $candidates = StorefrontOffer::query()
            ->where('storefront_id', $storefrontId)
            ->where('is_active', true)
            ->withinWindow($now)
            ->ordered()
            ->limit(self::MAX_OFFERS_PER_STOREFRONT)
            ->get();

        return array_values(array_filter(
            $this->evaluate($candidates, $salesChannelId, $now),
            fn (StorefrontOfferView $view) => $view->live,
        ));
    }

    /**
     * المساحة الإدارية: كل مرشّحات المتجر مع حالة كلٍّ (حيّ أو سبب الحجب).
     *
     * @return list<StorefrontOfferView>
     */
    public function allForStorefront(string $storefrontId, string $salesChannelId, ?CarbonInterface $now = null): array
    {
        $candidates = StorefrontOffer::query()
            ->where('storefront_id', $storefrontId)
            ->ordered()
            ->limit(self::MAX_OFFERS_PER_STOREFRONT)
            ->get();

        return $this->evaluate($candidates, $salesChannelId, $now);
    }

    /**
     * @param  Collection<int, StorefrontOffer>  $offers  بترتيب العرض؛ يُحفظ في الناتج.
     * @return list<StorefrontOfferView>
     */
    public function evaluate(Collection $offers, string $salesChannelId, ?CarbonInterface $now = null): array
    {
        if ($offers->isEmpty()) {
            return [];
        }

        $now ??= CarbonImmutable::now('UTC');
        $productIds = $offers->pluck('product_id')->unique()->values()->all();

        // المنتج مرجعٌ مخزَّن: بلا تصفية فرع (كـ`StorefrontProductController`)،
        // وبنطاق المستأجر تلقائياً — معرّفٌ أجنبي لا يُحلّ فيسقط كغير متاح.
        $products = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->whereIn('id', $productIds)
            ->get()
            ->keyBy('id');

        $published = CommerceListing::query()
            ->where('sales_channel_id', $salesChannelId)
            ->where('is_published', true)
            ->whereIn('product_id', $productIds)
            ->pluck('product_id')
            ->flip();

        $thumbnails = $this->thumbnails($productIds);

        /** @var array<string, string> $blocked offer id ⇒ reason */
        $blocked = [];
        /** @var array<string, StorefrontOffer> $priceable */
        $priceable = [];

        foreach ($offers as $offer) {
            $product = $products->get($offer->product_id);

            $reason = match (true) {
                ! $offer->is_active => self::REASON_INACTIVE,
                $offer->starts_at !== null && $offer->starts_at->gt($now) => self::REASON_SCHEDULED,
                $offer->ends_at !== null && $offer->ends_at->lt($now) => self::REASON_EXPIRED,
                $product === null || ! $product->is_active || ! $published->has($offer->product_id) => self::REASON_PRODUCT_UNAVAILABLE,
                $product->isVariantManaged() => self::REASON_VARIANT_MANAGED,
                default => null,
            };

            if ($reason !== null) {
                $blocked[$offer->id] = $reason;
            } else {
                $priceable[$offer->id] = $offer;
            }
        }

        $priced = $this->price($priceable, $products, $salesChannelId);

        $currency = null;
        $views = [];
        foreach ($offers as $offer) {
            $product = $products->get($offer->product_id);
            $thumbnail = $product !== null ? ($thumbnails[$offer->product_id] ?? null) : null;

            if (isset($blocked[$offer->id])) {
                $views[] = new StorefrontOfferView($offer, $product, false, $blocked[$offer->id], null, null, null, $thumbnail);

                continue;
            }

            [$reason, $reference, $offerPrice] = $priced[$offer->id];
            if ($reason !== null) {
                $views[] = new StorefrontOfferView($offer, $product, false, $reason, null, null, null, $thumbnail);

                continue;
            }

            $currency ??= $this->currency();
            $views[] = new StorefrontOfferView($offer, $product, true, null, $reference, $offerPrice, $currency, $thumbnail);
        }

        return $views;
    }

    /**
     * @param  array<string, StorefrontOffer>  $priceable
     * @param  Collection<string, Product>  $products
     * @return array<string, array{0: ?string, 1: ?int, 2: ?int}> offer id ⇒ [reason, reference, offer]
     */
    private function price(array $priceable, Collection $products, string $salesChannelId): array
    {
        if ($priceable === []) {
            return [];
        }

        $out = [];
        $notDiscounted = fn () => [self::REASON_NOT_DISCOUNTED, null, null];

        $channel = SalesChannel::query()->whereKey($salesChannelId)->first();
        $priceListId = $channel?->default_price_list_id;

        // (١) بلا قائمة أسعار افتراضية للقناة ⇒ الحسم دائماً السعر الأساسي ⇒ لا خصم.
        if ($priceListId === null) {
            foreach ($priceable as $id => $offer) {
                $out[$id] = $notDiscounted();
            }

            return $out;
        }

        // (٢) لا عنصر صريح لهذا المنتج (بلا متغيّر) في القائمة ⇒ السعر الأساسي ⇒ لا خصم.
        $listed = PriceListItem::query()
            ->where('price_list_id', $priceListId)
            ->whereNull('product_variant_id')
            ->whereIn('product_id', collect($priceable)->pluck('product_id')->unique()->values()->all())
            ->pluck('product_id')
            ->flip();

        foreach ($priceable as $id => $offer) {
            if (! $listed->has($offer->product_id)) {
                $out[$id] = $notDiscounted();

                continue;
            }

            $product = $products->get($offer->product_id);

            try {
                $resolved = $this->prices->resolve($product->id, $salesChannelId);
            } catch (RuntimeException) {
                // مرجعٌ تالف/محذوف/أجنبي أو وحدة غير صالحة: لا نحوّله إلى سعرٍ أساسي ولا نخمّن.
                $out[$id] = [self::REASON_PRICE_UNRESOLVED, null, null];

                continue;
            }

            $reference = (int) $product->sale_price;

            $out[$id] = $resolved->resolved && $resolved->amount !== null && $resolved->amount < $reference
                ? [null, $reference, $resolved->amount]
                : $notDiscounted();
        }

        return $out;
    }

    /**
     * أول وسيط مشترك لكل منتج بدفعة واحدة — الطبقة المشتركة نفسها في
     * `ProductMediaGalleryService::resolveGallery()` لمنتجٍ بلا متغيّر (نفس
     * الترتيب حرفياً)، بدل استعلامٍ لكل صف. المنتجات متعددة الخيارات تُحجب
     * قبل أن يُعرض لها أي صورة.
     *
     * @param  list<string>  $productIds
     * @return array<string, ProductMedia>
     */
    private function thumbnails(array $productIds): array
    {
        $first = [];
        $media = ProductMedia::query()
            ->whereIn('product_id', $productIds)
            ->whereNull('product_option_value_id')
            ->whereNull('product_variant_id')
            ->orderBy('sort_order')->orderBy('created_at')->orderBy('id')
            ->get();

        foreach ($media as $item) {
            $first[$item->product_id] ??= $item;
        }

        return $first;
    }

    private function currency(): string
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return Tenant::findOrFail($tenantId)->currency;
    }
}
