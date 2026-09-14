<?php

namespace App\Services\Commerce;

use App\Models\Partner;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\Accounting\PosCustomerPriceListResolver;
use App\Services\Accounting\UnitConversion;
use App\Services\PriceListService;
use App\Services\ProductPricingService;
use App\Support\Settings;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
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
    ) {}

    /**
     * `$lockEligibility` اختياريٌ (افتراضه `false`): يفعّله فقط استدعاءٌ يكتب
     * أثراً بناءً على هذا السعر داخل نفس المعاملة (سطر سلة تجارة — Cart V1)،
     * فيقفل صفّ قائمة السعر المختارة وعنصرها المطابق حتى تمام الالتزام — راجع
     * `PriceListService::resolve()`. لا أثر له على المسار المباشر
     * `Product.sale_price` (وحدة أساس بلا قائمة سعر مطابقة): ذاك يبقى بلا أي
     * استعلام أو قفل إضافي، كما كان قبل هذا الخيار.
     *
     * @throws RuntimeException المنتج/القناة/العميل غير موجودين لمستأجر السياق
     *                          الحالي، أو وحدة غير معرَّفة على قالب وحدات المنتج.
     */
    public function resolve(
        string $productId,
        string $salesChannelId,
        ?string $partnerId = null,
        ?string $unitName = null,
        bool $lockEligibility = false,
    ): ResolvedCommercePrice {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $product = Product::query()->withoutGlobalScope(BranchScope::class)->whereKey($productId)->first();
        if ($product === null) {
            throw new RuntimeException('المنتج غير موجود.');
        }

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
        $listPrice = $priceList ? $this->priceLists->resolve($priceList, $product, $unitName, $lockEligibility) : null;

        if ($listPrice !== null) {
            $amount = $listPrice;
            $source = ResolvedCommercePrice::SOURCE_PRICE_LIST;
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
}
