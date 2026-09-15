<?php

namespace App\Services\Pos;

use App\Models\Partner;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductVariant;
use App\Services\Accounting\PosCustomerPriceListResolver;
use App\Support\DocumentLineVariantResolver;
use App\Tenancy\TenantContext;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PosBarcodeResolver — الحل الخادمي الوحيد لباركودٍ مسحه الكاشير (VAR-POS-1)
 * ═══════════════════════════════════════════════════════════════
 *  الباركود **محلٌّ (resolver) لا سلطة سعر** — العقد الموثّق:
 *  docs/plans/products-inventory/AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md.
 *  يعيد هوية المنتج/المتغيّر/الوحدة والسعر المعياري المحلول من سلطة VAR-PRICE-1
 *  (`PosCustomerPriceListResolver`) — لا يُشتقّ السعر من الباركود نفسه أبداً،
 *  ولا من معامل تحويل الوحدة.
 *
 *  ترتيب الحلّ: `ProductBarcode` (بديل، متعدد الوحدات/المتغيّرات، PR-UOM-1 +
 *  VAR-POS-1) أولاً، ثم `products.barcode` (الأساسي التاريخي). كلاهما مُصفًّى
 *  بمستأجر السياق النشط حصراً — لا معرّف عابرٍ من العميل.
 *
 *  **منتجٌ متعدد الخيارات لا هوية غامضة له عبر الباركود إطلاقاً:** باركودٌ
 *  أساسي على الأب، أو باركودٌ بديل بلا `product_variant_id`، لمنتجٍ
 *  `variant_managed` يُرفض بدل افتراض متغيّرٍ أو ترك الهوية معلَّقة — نفس مبدأ
 *  VAR-DOC-1 حرفياً («لا مسار بيع غامض على الأب»).
 */
class PosBarcodeResolver
{
    public function __construct(protected PosCustomerPriceListResolver $priceLists) {}

    /** @return array{product: Product, variant: ?ProductVariant, variant_descriptor: ?string, unit: string, unit_factor: int, price: int} */
    public function resolve(string $code, ?PriceList $priceList): array
    {
        $tenantId = app(TenantContext::class)->id();
        $code = trim($code);
        if ($code === '') {
            throw new RuntimeException('باركودٌ فارغ.');
        }

        $alternate = ProductBarcode::with(['product', 'variant'])->where('code', $code)->first();

        if ($alternate !== null) {
            $product = $alternate->product;
            if ($product === null || ! $product->is_active) {
                throw new RuntimeException('لم يُعثر على منتجٍ مطابقٍ لهذا الباركود.');
            }

            $variant = $alternate->product_variant_id !== null
                ? DocumentLineVariantResolver::resolve($product, $alternate->product_variant_id, $tenantId)
                : null;
            $this->assertConcreteIdentity($product, $variant);

            $unitName = $alternate->unit_name ?? $product->unit;

            return $this->priced($product, $variant, $unitName, $priceList);
        }

        // الباركود الأساسي التاريخي أو رمز الصنف (SKU) — نفس مسحٍ خادميٍّ واحد
        // يطابق ما كانت الواجهة تطابقه محلياً (`matchPosBarcode`) لوحدة الأساس.
        $product = Product::where('tenant_id', $tenantId)
            ->where(fn ($query) => $query->where('barcode', $code)->orWhere('sku', $code))
            ->first();
        if ($product === null || ! $product->is_active) {
            throw new RuntimeException('لم يُعثر على منتجٍ مطابقٍ لهذا الباركود.');
        }

        // الباركود الأساسي التاريخي يرتبط بوحدة الأساس ولا يحمل متغيّراً أبداً
        // — فمنتجٌ متعدد الخيارات يُرفض هنا بدل افتراض أول متغيّرٍ صامتاً.
        $this->assertConcreteIdentity($product, null);

        return $this->priced($product, null, $product->unit, $priceList);
    }

    /** فشلٌ مغلَق: منتجٌ متعدد الخيارات بلا متغيّرٍ محلولٍ من الباركود هويّةٌ غامضة. */
    private function assertConcreteIdentity(Product $product, ?ProductVariant $variant): void
    {
        if ($product->isVariantManaged() && $variant === null) {
            throw new RuntimeException('هذا الباركود لا يحدِّد متغيّراً فعلياً لمنتجٍ متعدد الخيارات.');
        }
        if ($variant !== null && ! $variant->is_active) {
            throw new RuntimeException('هذا المتغيّر معطَّل ولا يصلح للاستخدام التجاري.');
        }
    }

    /** @return array{product: Product, variant: ?ProductVariant, variant_descriptor: ?string, unit: string, unit_factor: int, price: int} */
    private function priced(Product $product, ?ProductVariant $variant, string $unitName, ?PriceList $priceList): array
    {
        $price = $this->priceLists->posPriceFor($priceList, $product, $unitName, $variant);
        if ($price === null) {
            throw new RuntimeException('لا يوجد سعرٌ معياريٌّ صريح لهذه الوحدة.');
        }

        $unitFactor = 1;
        if ($product->unitTemplate) {
            $templateUnit = $product->unitTemplate->units->firstWhere('name', $unitName);
            $unitFactor = $templateUnit ? (int) $templateUnit->factor : 1;
        }

        return [
            'product' => $product,
            'variant' => $variant,
            'variant_descriptor' => $variant !== null ? DocumentLineVariantResolver::descriptor($variant) : null,
            'unit' => $unitName,
            'unit_factor' => $unitFactor,
            'price' => $price,
        ];
    }
}
