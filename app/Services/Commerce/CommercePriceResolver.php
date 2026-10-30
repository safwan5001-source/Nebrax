<?php

namespace App\Services\Commerce;

use App\Models\Partner;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\ProductUnitPrice;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\Accounting\PosCustomerPriceListResolver;
use App\Services\Accounting\UnitConversion;
use App\Services\PriceListService;
use App\Services\ProductPricingService;
use App\Support\DocumentLineVariantResolver;
use App\Support\Settings;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Commerce Price Resolution — اقتراح، لا محرك مالي (PR-COM-4A)
 * ═══════════════════════════════════════════════════════════════
 *
 * **لا مصدر سعر ثانٍ**: هذا الصنف لا يخزّن سعراً ولا ينشئه — يُنسِّق مصادر
 * التسعير الموجودة فعلاً (`PriceListService`, `PosCustomerPriceListResolver`,
 * `UnitConversion`, `Product.sale_price`) ويعيد اقتراحاً للقراءة فقط. مصدر
 * الحقيقة المالي التاريخي يبقى سطر الفاتورة بعد `InvoiceService::applyItemsAndTotals()`
 * — هذا الصنف لا يستدعيه ولا يقترب منه.
 *
 * **الأسبقية (COM-PRICE-1)**:
 *   1. عميلٌ (`Partner`) مُمرَّر ← `forPartner()` يحلّ قائمة سعره الافتراضية
 *      (نشطة فقط)، **مقيّدةً بنفس سياسة POS الحالية** `apply_customer_price_list`
 *      (`App\Support\PosSettings`) — لم تُستنسخ هذه البوابة هنا، بل استُدعيت
 *      كما هي عبر الحقن، فتبقى Commerce والـ POS تحت نفس القرار دائماً؛ لا
 *      قراران منفصلان قد ينحرفان.
 *   2. وإلا قائمة قناة البيع الافتراضية، إن كانت نشطة ومن مستأجر القناة نفسه.
 *   3. إن وُجد عنصر صريح لهذا المنتج/الوحدة في القائمة المحلولة ⇐ هو السعر.
 *   4. وإلا، السعر الأساسي الصريح لهذا المنتج/الوحدة (VAR-PRICE-1:
 *      `ProductPricingService`) — لوحدة الأساس هذا فعلياً `Product.sale_price`
 *      نفسه (سلطةٌ واحدة عبر القراءة الشفافة)، ولوحدةٍ بديلة سعرٌ صريحٌ إن
 *      وُجد، لا سعرٌ مشتقٌّ من معامل التحويل أبداً.
 *   5. وإلا ⇐ **لا سعر قابل للحسم**.
 *
 * **UOM**: يستدعي `UnitConversion::resolve()` — نفس السلطة الوحيدة في
 * أَوْج — فيرث تحققها ورفضها لوحدة غير معرَّفة بلا أي منطق تحويل جديد هنا.
 *
 * **العملة**: لا عمود عملة على `PriceList`/`PriceListItem`/`Product` إطلاقاً
 * (نظامٌ أحادي العملة لكل مستأجر) — العملة الحقيقية الوحيدة هي
 * `Tenant.currency`، تُقرأ لا تُخترع؛ **ممنوعٌ** ترميز `SAR` هنا.
 *
 * **الحدّ الأدنى**: `min_sale_price` يُعاد كبيانٍ وصفي فقط (نفس بوابة
 * `InvoiceService::minimumPriceDecision()`: `Settings::get('sales',
 * 'enforce_min_sale_price')` + قيمة موجبة) — لا إنفاذ هنا؛ الإنفاذ يبقى حصرياً
 * عند الترحيل المالي الفعلي.
 *
 * **الضريبة**: غائبة عمداً بالكامل — لا حساب VAT ولا تحويل شامل/غير شامل ولا
 * فئات ZATCA. راجع `App\Support\CommerceBoundary`.
 */
final class CommercePriceResolver
{
    public function __construct(
        private readonly PriceListService $priceLists,
        private readonly PosCustomerPriceListResolver $partnerPriceLists,
        private readonly UnitConversion $units,
        private readonly ProductPricingService $pricing,
        private readonly WholesalePriceAuthority $wholesale,
    ) {}

    /**
     * `$lockEligibility` اختياريٌ (افتراضه `false`): يفعّله فقط استدعاءٌ يكتب
     * أثراً بناءً على هذا السعر داخل نفس المعاملة (سطر سلة تجارة — Cart V1)،
     * فيقفل صفّ قائمة السعر المختارة وعنصرها المطابق حتى تمام الالتزام — راجع
     * `PriceListService::resolve()`. لا أثر له على المسار المباشر
     * `Product.sale_price` (وحدة أساس بلا قائمة سعر مطابقة): ذاك يبقى بلا أي
     * استعلام أو قفل إضافي، كما كان قبل هذا الخيار.
     *
     * `$variantId`: VAR-COM-1 — `null` لمنتجٍ بسيط (السلوك الحالي حرفياً، لا
     * تغيير). لمنتجٍ متعدد الخيارات، متغيّرٌ فعليٌّ محلولٌ عبر
     * `DocumentLineVariantResolver::resolve()` — نفس سلطة VAR-DOC-1/VAR-POS-1
     * الوحيدة (فشلٌ مغلَق: انتماءٌ للمنتج، عزل مستأجر، نشاطٌ تجاري)، لا نسخة
     * تحقّقٍ ثانية هنا.
     *
     * @throws RuntimeException المنتج/القناة/العميل/المتغيّر غير صالحين
     *                          لمستأجر السياق الحالي، أو وحدة غير معرَّفة على
     *                          قالب وحدات المنتج.
     */
    public function resolve(
        string $productId,
        string $salesChannelId,
        ?string $partnerId = null,
        ?string $unitName = null,
        bool $lockEligibility = false,
        ?string $variantId = null,
    ): ResolvedCommercePrice {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $product = Product::query()->withoutGlobalScope(BranchScope::class)->whereKey($productId)->first();
        if ($product === null) {
            throw new RuntimeException('المنتج غير موجود.');
        }

        $variant = DocumentLineVariantResolver::resolve($product, $variantId, $tenantId);

        $salesChannel = SalesChannel::query()->whereKey($salesChannelId)->first();
        if ($salesChannel === null) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }

        if ($partnerId !== null
            && ! Partner::query()->withoutGlobalScope(BranchScope::class)->whereKey($partnerId)->exists()
        ) {
            throw new RuntimeException('العميل غير موجود.');
        }

        // يتحقق من الوحدة ويرفض ما هو غير معرَّف — null يعني وحدة الأساس.
        [$resolvedUnitName] = $this->units->resolve($product, $unitName);
        $isAlternativeUnit = $resolvedUnitName !== null;

        // H6 Batch J — a wholesale channel is priced ONLY by the approved precedence (buyer's partner list → channel list →
        // unavailable). The caller's `$partnerId` is ignored there (the buyer comes from the server session), and the
        // product/base price is never a substitute. Every other channel falls through to the unchanged logic below.
        if ($this->wholesale->governs($salesChannel)) {
            return $this->resolveWholesale($salesChannel, $product, $variant, $unitName, $resolvedUnitName, $lockEligibility);
        }

        $priceList = $partnerId !== null ? $this->partnerPriceLists->forPartner($partnerId) : null;
        if ($priceList === null && $salesChannel->default_price_list_id !== null) {
            $channelPriceList = $salesChannel->defaultPriceList()->first();
            if ($channelPriceList === null) {
                // A configured reference that TenantScope cannot resolve is corrupt,
                // deleted, or cross-tenant. Never turn that into a base-price fallback.
                throw new RuntimeException('قائمة أسعار قناة البيع غير متاحة لهذا المستأجر.');
            }

            $priceList = $channelPriceList->is_active ? $channelPriceList : null;
        }
        $listPrice = $priceList
            ? $this->priceLists->resolve($priceList, $product, $unitName, $lockEligibility, $variant)
            : null;

        if ($listPrice !== null) {
            $amount = $listPrice;
            $source = ResolvedCommercePrice::SOURCE_PRICE_LIST;
        } elseif ($variant !== null) {
            // VAR-PRICE-1: سعر المتغيّر الصريح ← وإلا سعر المنتج الأساسي لنفس
            // الوحدة ← وإلا لا سعر — نفس سلطة `resolveSellable()` المستعملة
            // حرفياً في POS (VAR-POS-1)، بلا تراجعٍ عبر وحداتٍ مختلفة ولا على
            // شقيقٍ آخر. توحيدٌ واحد لوحدة الأساس والوحدة البديلة معاً — خلافاً
            // للفرع أدناه، لا حاجة لتمييز `isAlternativeUnit` لأن `resolveSellable()`
            // تتعامل مع كليهما بنفس الاصطلاح (`null` = وحدة الأساس).
            $canonicalUnitPrice = $this->pricing->resolveSellable($product, $variant, $unitName);
            $amount = $canonicalUnitPrice;
            $source = $canonicalUnitPrice !== null
                ? ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT
                : ResolvedCommercePrice::SOURCE_NONE;
        } elseif (! $isAlternativeUnit) {
            $amount = (int) $product->sale_price;
            $source = ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT;
        } else {
            // VAR-PRICE-1: السلطة الأساسية الصريحة لوحدةٍ بديلة (لا قائمة
            // أسعار طبّقت) — لم تكن موجودة أصلاً قبل هذا المعيار، فالنتيجة
            // كانت دائماً `null` هنا. الآن تُستشار قبل الاستسلام لـ«لا سعر»،
            // بلا أي اشتقاقٍ من معامل التحويل (نفس تحذير العقد حرفياً).
            $canonicalUnitPrice = $this->pricing->resolveExplicit($product, null, $unitName);
            $amount = $canonicalUnitPrice;
            $source = $canonicalUnitPrice !== null
                ? ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT
                : ResolvedCommercePrice::SOURCE_NONE;
        }

        $minSalePrice = null;
        if (Settings::get('sales', 'enforce_min_sale_price')) {
            $floor = (int) ($product->min_sale_price ?? 0);
            $minSalePrice = $floor > 0 ? $floor : null;
        }

        return new ResolvedCommercePrice(
            resolved: $amount !== null,
            amount: $amount,
            currency: Tenant::findOrFail($tenantId)->currency,
            source: $source,
            priceListId: $priceList?->id,
            unitName: $resolvedUnitName,
            minSalePrice: $minSalePrice,
        );
    }

    /**
     * Anonymous-browse price for a whole page of simple products — the batched
     * twin of `resolve($id, $channelId)` (no partner, no unit, no variant).
     * H6-F: the listing used to read `Product.sale_price` directly, so a channel
     * with an active `default_price_list_id` showed the list price on detail/cart
     * but the retail price in the listing.
     *
     * Same precedence as `resolve()` for this context: the channel's default list
     * (active only) item for the product's own unit, else `Product.sale_price`.
     * A channel without an active list therefore returns `sale_price` exactly as
     * the listing always did (DTC output unchanged, no list query at all). With a
     * list it costs one `price_list_items` query for the whole page. A configured
     * reference TenantScope cannot resolve is corrupt/cross-tenant and throws —
     * identical to `resolve()`, never a silent retail fallback.
     *
     * Variant-managed products keep the listing's historical `0` (their price is
     * per variant and resolved in `show()`).
     *
     * @param  Collection<int, Product>  $products
     * @return array<string, int> productId => minor units
     *
     * @throws RuntimeException
     */
    public function browsePrices(Collection $products, string $salesChannelId): array
    {
        if (app(TenantContext::class)->id() === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $priceList = $this->activeChannelPriceList($salesChannelId);

        $simple = $products->reject(fn (Product $p): bool => $p->isVariantManaged());

        $key = static fn (string $productId, ?string $unit): string => $productId."\0".($unit ?? "\0null");
        $ids = $simple->pluck('id')->all();

        // One query for the base prices too: `Product::sale_price` is an accessor over `product_unit_prices`
        // and would otherwise cost one query per row. Same value as the accessor (the product's own unit, `0`
        // when there is none).
        $basePrices = [];
        $listPrices = [];
        if ($ids !== []) {
            foreach (ProductUnitPrice::query()->whereIn('product_id', $ids)->whereNull('product_variant_id')->get(['product_id', 'unit_name', 'price']) as $row) {
                $basePrices[$key($row->product_id, $row->unit_name)] = (int) $row->price;
            }
            if ($priceList !== null) {
                $items = PriceListItem::query()
                    ->where('price_list_id', $priceList->id)
                    ->whereIn('product_id', $ids)
                    ->whereNull('product_variant_id')
                    ->get(['product_id', 'unit_name', 'price']);
                foreach ($items as $item) {
                    $listPrices[$key($item->product_id, $item->unit_name)] = (int) $item->price;
                }
            }
        }

        $out = [];
        foreach ($products as $product) {
            if ($product->isVariantManaged()) {
                $out[$product->id] = 0;

                continue;
            }
            $k = $key($product->id, $product->unit);
            $out[$product->id] = $listPrices[$k] ?? $basePrices[$k] ?? 0;
        }

        return $out;
    }

    /**
     * The channel's default price list when it is set AND active; `null` otherwise (no list, or inactive ⇒
     * ignored). A configured reference TenantScope cannot resolve is corrupt/deleted/cross-tenant and throws —
     * never a base-price fallback. Shared by {@see self::browsePrices()} and the listing's price sort so both
     * agree on which list (if any) prices the channel.
     *
     * @throws RuntimeException
     */
    public function activeChannelPriceList(string $salesChannelId): ?PriceList
    {
        $salesChannel = SalesChannel::query()->whereKey($salesChannelId)->first();
        if ($salesChannel === null) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }
        if ($salesChannel->default_price_list_id === null) {
            return null;
        }

        $channelPriceList = $salesChannel->defaultPriceList()->first();
        if ($channelPriceList === null) {
            throw new RuntimeException('قائمة أسعار قناة البيع غير متاحة لهذا المستأجر.');
        }

        return $channelPriceList->is_active ? $channelPriceList : null;
    }

    private function resolveWholesale(
        SalesChannel $salesChannel,
        Product $product,
        ?\App\Models\ProductVariant $variant,
        ?string $unitName,
        ?string $resolvedUnitName,
        bool $lockEligibility,
    ): ResolvedCommercePrice {
        $context = $this->wholesale->context($salesChannel);
        $hit = $this->wholesale->priceFor($context, $product, $unitName, $variant, $lockEligibility);

        $minSalePrice = null;
        if (Settings::get('sales', 'enforce_min_sale_price')) {
            $floor = (int) ($product->min_sale_price ?? 0);
            $minSalePrice = $floor > 0 ? $floor : null;
        }

        $currency = Tenant::findOrFail(app(TenantContext::class)->id())->currency;

        if ($hit === null) {
            return new ResolvedCommercePrice(
                resolved: false,
                amount: null,
                currency: $currency,
                source: ResolvedCommercePrice::SOURCE_NONE,
                priceListId: null,
                unitName: $resolvedUnitName,
                minSalePrice: $minSalePrice,
                unavailableReason: ResolvedCommercePrice::UNAVAILABLE_FOR_WHOLESALE,
            );
        }

        return new ResolvedCommercePrice(
            resolved: true,
            amount: $hit['amount'],
            currency: $currency,
            source: ResolvedCommercePrice::SOURCE_PRICE_LIST,
            priceListId: $hit['priceList']->id,
            unitName: $resolvedUnitName,
            minSalePrice: $minSalePrice,
        );
    }

    /** Is this channel priced by the wholesale authority (flagged wholesale)? Listings use it to pick the path. */
    public function isWholesaleChannel(string $salesChannelId): bool
    {
        return $this->wholesale->governsId($salesChannelId);
    }

    /**
     * Wholesale twin of {@see self::browsePrices()}: one batched resolution per page by the same precedence as
     * {@see self::resolve()}. `null` = unavailable for wholesale (no eligible entry); never the base price.
     * A variant-managed product keeps the listing's historical `0` when ANY of its variants has an eligible entry
     * (its real prices are per variant, shown on detail) and is `null` when none does.
     *
     * @param  Collection<int, Product>  $products
     * @return array<string, ?int> productId => minor units, or null when unavailable
     */
    public function browseWholesalePrices(Collection $products, string $salesChannelId): array
    {
        $salesChannel = SalesChannel::query()->whereKey($salesChannelId)->first();
        if ($salesChannel === null) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }

        $context = $this->wholesale->context($salesChannel);
        $out = [];
        $listIds = array_map(fn (PriceList $l): string => $l->id, $context->lists());

        $simple = $products->reject(fn (Product $p): bool => $p->isVariantManaged());
        $variantManaged = $products->filter(fn (Product $p): bool => $p->isVariantManaged());

        $items = [];
        $variantEntries = [];
        if ($listIds !== []) {
            $simpleIds = $simple->pluck('id')->all();
            if ($simpleIds !== []) {
                foreach (PriceListItem::query()->whereIn('price_list_id', $listIds)->whereIn('product_id', $simpleIds)->whereNull('product_variant_id')->get(['price_list_id', 'product_id', 'unit_name', 'price']) as $item) {
                    $items[$item->price_list_id."\0".$item->product_id."\0".$item->unit_name] = (int) $item->price;
                }
            }
            $managedIds = $variantManaged->pluck('id')->all();
            if ($managedIds !== []) {
                foreach (PriceListItem::query()->whereIn('price_list_id', $listIds)->whereIn('product_id', $managedIds)->whereNotNull('product_variant_id')->get(['product_id']) as $item) {
                    $variantEntries[$item->product_id] = true;
                }
            }
        }

        foreach ($products as $product) {
            if (! $context->eligible) {
                $out[$product->id] = null;

                continue;
            }
            if ($product->isVariantManaged()) {
                $out[$product->id] = isset($variantEntries[$product->id]) ? 0 : null;

                continue;
            }
            $price = null;
            foreach ($listIds as $listId) {
                $key = $listId."\0".$product->id."\0".$product->unit;
                if (array_key_exists($key, $items)) {
                    $price = $items[$key];

                    break;
                }
            }
            $out[$product->id] = $price;
        }

        return $out;
    }

    /**
     * The (partner list id, channel list id) pair that prices this request on a wholesale channel, for the listing's
     * price sort — so the order agrees with the amounts shown. `[null, null]` for an ineligible request.
     *
     * @return array{0: ?string, 1: ?string}
     */
    public function wholesaleListIds(string $salesChannelId): array
    {
        $salesChannel = SalesChannel::query()->whereKey($salesChannelId)->first();
        if ($salesChannel === null) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }
        $context = $this->wholesale->context($salesChannel);

        return $context->eligible ? [$context->partnerList?->id, $context->channelList?->id] : [null, null];
    }
}
