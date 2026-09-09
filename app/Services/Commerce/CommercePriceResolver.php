<?php

namespace App\Services\Commerce;

use App\Models\Partner;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\Accounting\PosCustomerPriceListResolver;
use App\Services\Accounting\UnitConversion;
use App\Services\PriceListService;
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
 * **الأسبقية المُعاد استعمالها حرفياً من `PosCustomerPriceListResolver`
 * (AWJ VERIFIED من `PosService::checkout()`، لا اختراع)**:
 *   1. عميلٌ (`Partner`) مُمرَّر ← `forPartner()` يحلّ قائمة سعره الافتراضية
 *      (نشطة فقط)، **مقيّدةً بنفس سياسة POS الحالية** `apply_customer_price_list`
 *      (`App\Support\PosSettings`) — لم تُستنسخ هذه البوابة هنا، بل استُدعيت
 *      كما هي عبر الحقن، فتبقى Commerce والـ POS تحت نفس القرار دائماً؛ لا
 *      قراران منفصلان قد ينحرفان.
 *   2. إن وُجد عنصر صريح لهذا المنتج/الوحدة في القائمة المحلولة ⇐ هو السعر.
 *   3. وإلا، إن كانت الوحدة **وحدة الأساس** ⇐ `Product.sale_price`.
 *   4. وإلا (وحدة بديلة بلا سعرٍ صريح) ⇐ **لا سعر قابل للحسم** — لا يُشتقّ
 *      سعر عبوة من معامل التحويل أبداً (نفس تحذير `posPriceFor()` حرفياً).
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
    ) {}

    /**
     * @throws RuntimeException المنتج/القناة/العميل غير موجودين لمستأجر السياق
     *                          الحالي، أو وحدة غير معرَّفة على قالب وحدات المنتج.
     */
    public function resolve(
        string $productId,
        string $salesChannelId,
        ?string $partnerId = null,
        ?string $unitName = null,
    ): ResolvedCommercePrice {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $product = Product::query()->withoutGlobalScope(BranchScope::class)->whereKey($productId)->first();
        if ($product === null) {
            throw new RuntimeException('المنتج غير موجود.');
        }

        if (! SalesChannel::query()->whereKey($salesChannelId)->exists()) {
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
        $listPrice = $priceList ? $this->priceLists->resolve($priceList, $product, $unitName) : null;

        if ($listPrice !== null) {
            $amount = $listPrice;
            $source = ResolvedCommercePrice::SOURCE_PRICE_LIST;
        } elseif (! $isAlternativeUnit) {
            $amount = (int) $product->sale_price;
            $source = ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT;
        } else {
            $amount = null;
            $source = ResolvedCommercePrice::SOURCE_NONE;
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
