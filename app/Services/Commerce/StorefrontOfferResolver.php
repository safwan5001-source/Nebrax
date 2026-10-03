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
 * `CommercePriceResolver`.
 *
 * **النسبة مشتقّة لا سلطة** (§23.3 خطوة 4): `discountPercent = round((ref − offer)
 * / ref × 100)` تُحسب طازجةً عند كل قراءة من الرقمين المُثبَتَين أعلاه فقط، بعد
 * التأكد أن `ref > 0` و`0 ≤ offer < ref`، وتُقرَّب بنصفٍ لأعلى بحسابٍ صحيحٍ بلا
 * float (`(2·diff·100 + ref) div 2·ref`). لا تُخزَّن، ولا تُقبل في أي حمولة كتابة.
 * قد تساوي 0 لخصمٍ دون نصف بالمئة — خصمٌ حقيقي تعرضه الواجهة كما تراه مناسباً.
 *
 * **قابلية البيع (ATS)** — بوابة ثانية بعد الخصم، تعكس **حرفياً** ما يطبّقه
 * `CommerceCheckoutService` فعلاً عند الإتمام، لا منطق مخزون جديداً:
 *   - منتجٌ `track_inventory = false` ⇒ لا فحص توفّر (كما يتخطّاه Checkout/الحجز).
 *   - منتجٌ متتبَّع ⇒ مخزن تنفيذ القناة عبر `FulfillmentPolicyService` (غيابه ⇒
 *     `fulfillment_not_configured`، نفس سبب الفشل في Checkout) ثم
 *     `AvailableToSellService::forWarehouse()`؛ `availableToSell <= 0` ⇒ `out_of_stock`.
 * العرض غير القابل للبيع لا يظهر علناً. هذه البوابة خاصةٌ بقسم العروض؛ قوائم
 * المنتجات العامة تبقى تعرض `in_stock` معلوماتياً كما هي.
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

    public const REASON_OUT_OF_STOCK = 'out_of_stock';

    /** نفس سبب فشل `CommerceCheckoutService` لمنتجٍ متتبَّع بلا مخزن تنفيذ. */
    public const REASON_FULFILLMENT_NOT_CONFIGURED = 'fulfillment_not_configured';

    public const REASON_AVAILABILITY_UNRESOLVED = 'availability_unresolved';

    public function __construct(
        private readonly CommercePriceResolver $prices,
        private readonly AvailableToSellService $availability,
        private readonly FulfillmentPolicyService $fulfillment,
    ) {}

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

        // قابلية البيع تُفحص للمنتجات ذات الخصم الحقيقي وحدها: لا استعلامات مخزون
        // لما سيُحجب أصلاً.
        $liveCandidates = array_filter($priceable, fn (StorefrontOffer $o) => $priced[$o->id][0] === null);
        $unsellable = $this->unsellable($liveCandidates, $products, $salesChannelId);

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
            $reason ??= $unsellable[$offer->id] ?? null;
            if ($reason !== null) {
                $views[] = new StorefrontOfferView($offer, $product, false, $reason, null, null, null, $thumbnail);

                continue;
            }

            $currency ??= $this->currency();
            $views[] = new StorefrontOfferView(
                $offer, $product, true, null, $reference, $offerPrice, $currency, $thumbnail,
                self::discountPercent($reference, $offerPrice),
            );
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

            $out[$id] = $resolved->resolved && $resolved->amount !== null
                && $reference > 0 && $resolved->amount >= 0 && $resolved->amount < $reference
                ? [null, $reference, $resolved->amount]
                : $notDiscounted();
        }

        return $out;
    }

    /**
     * نسبة الخصم الصحيحة المقرَّبة (نصفٌ لأعلى) من السعرين المُثبَتَين — بلا float،
     * وتُستدعى فقط بعد التحقق من `ref > 0` و`0 <= offer < ref`.
     */
    public static function discountPercent(int $reference, int $offer): int
    {
        return intdiv(($reference - $offer) * 200 + $reference, 2 * $reference);
    }

    /**
     * @param  array<string, StorefrontOffer>  $candidates  عروضٌ لها خصمٌ حقيقي.
     * @param  Collection<string, Product>  $products
     * @return array<string, string> offer id ⇒ سبب عدم القابلية للبيع (الصالحة لا تظهر).
     */
    private function unsellable(array $candidates, Collection $products, string $salesChannelId): array
    {
        $out = [];
        $warehouse = null;
        $warehouseFailed = false;

        foreach ($candidates as $id => $offer) {
            $product = $products->get($offer->product_id);

            // كما يتخطّاه Checkout/الحجز: غير المتتبَّع لا فحص توفّر له.
            if (! $product->track_inventory) {
                continue;
            }

            if ($warehouse === null && ! $warehouseFailed) {
                try {
                    $warehouse = $this->fulfillment->resolveWarehouseFor($salesChannelId);
                } catch (FulfillmentPolicyNotConfiguredException) {
                    $warehouseFailed = true;
                } catch (RuntimeException) {
                    $warehouseFailed = true;
                }
            }

            if ($warehouse === null) {
                $out[$id] = self::REASON_FULFILLMENT_NOT_CONFIGURED;

                continue;
            }

            try {
                $atsOk = $this->availability->forWarehouse($product->id, $warehouse->id)->availableToSell > 0;
            } catch (RuntimeException) {
                $out[$id] = self::REASON_AVAILABILITY_UNRESOLVED;

                continue;
            }

            if (! $atsOk) {
                $out[$id] = self::REASON_OUT_OF_STOCK;
            }
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
