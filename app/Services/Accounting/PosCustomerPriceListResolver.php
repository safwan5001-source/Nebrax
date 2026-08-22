<?php

namespace App\Services\Accounting;

use App\Models\Partner;
use App\Models\PriceList;
use App\Models\Product;
use App\Services\PriceListService;
use App\Support\PosSettings;

/**
 * يربط POS بقائمة السعر الافتراضية للعميل من مصدر واحد.
 *
 * لا يكتب هذا المحلّل فاتورة أو قيداً ولا يعيد تفسير لقطة سطر تاريخي؛ وظيفته
 * اقتراح/التحقق من سعر المنتج قبل إنشاء فاتورة جديدة فقط.
 */
class PosCustomerPriceListResolver
{
    public function __construct(protected PriceListService $priceLists) {}

    /** يعيد قائمة العميل النشطة فقط عندما تكون سياسة POS مفعلة. */
    public function forPartner(?string $partnerId): ?PriceList
    {
        if (! PosSettings::appliesCustomerPriceList() || $partnerId === null) {
            return null;
        }

        $partner = Partner::find($partnerId);
        if (! $partner || ! $partner->default_price_list_id) {
            return null;
        }

        $priceList = PriceList::find($partner->default_price_list_id);

        return $priceList?->is_active ? $priceList : null;
    }

    /** سعر القائمة الصريح بالهللات إن وجد، وإلا سعر البيع الأساسي للمنتج. */
    public function priceFor(?PriceList $priceList, Product $product, ?string $unitName = null): int
    {
        return $priceList
            ? ($this->priceLists->resolve($priceList, $product, $unitName) ?? (int) $product->sale_price)
            : (int) $product->sale_price;
    }
}
