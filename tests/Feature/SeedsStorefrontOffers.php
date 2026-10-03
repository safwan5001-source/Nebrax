<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\StorefrontOffer;
use App\Models\Tenant;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Str;

/**
 * CUST-H4-6 — تهيئة بيانات اختبارات العروض (مشتركة بين اختبار النموذج ومساحة
 * العمل والقراءة العامة). كل دالة تضبط سياق المستأجر وتُنسيه قبل العودة، فلا
 * يتسرّب سياقٌ بين الخطوات (نمط الاختبارات الشقيقة).
 */
trait SeedsStorefrontOffers
{
    /**
     * متجرٌ بنطاق مخصّص موثَّق ونشط (للقراءة العامة)، ومنه نفسه متجرٌ يصلح لمساحة
     * العمل. `$webSlug` يتيح قناتين ويب للمستأجر نفسه (متجران).
     *
     * @return array{channel: SalesChannel, storefront: Storefront, domain: StorefrontDomain}
     */
    protected function offerStore(string $tenantId, ?string $host = null, string $webSlug = 'web'): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::create([
            'slug' => $webSlug, 'name' => 'ويب '.$webSlug, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'sf-'.$webSlug, 'name' => 'متجر '.$webSlug, 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $host ?? ('h-'.Str::lower(Str::random(8)).'.example.test'),
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront', 'domain');
    }

    protected function publicTenant(string $slug = 'offers'): Tenant
    {
        return Tenant::create([
            'name' => 'متجر '.$slug, 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
    }

    protected function offerProduct(string $tenantId, SalesChannel $channel, array $attrs = [], bool $published = true): Product
    {
        app(TenantContext::class)->set($tenantId);

        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج', 'name_en' => 'Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 25000, 'tax_rate' => 15,
            'is_active' => true,
            // `avg_cost` عمداً غائب: يزرع هويّة مخزون (inventory_states) تمنع حذف المنتج في اختبار التنظيف.
            'purchase_price' => 8000, 'internal_notes' => 'سرّي',
        ], $attrs));

        if ($published) {
            CommerceListing::create([
                'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
            ]);
        }

        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    /**
     * قائمة أسعار افتراضية للقناة، بعناصر صريحة `[معرّف منتج => سعر]`. هذا هو
     * المصدر الوحيد للخصم الحقيقي في Commerce (نفس ما تستعمله سلة تجارة).
     *
     * @param  array<string, int>  $prices
     */
    protected function channelPriceList(string $tenantId, SalesChannel $channel, array $prices, bool $active = true): PriceList
    {
        app(TenantContext::class)->set($tenantId);

        // `SalesChannel` يرفض تعيين قائمة غير نشطة افتراضيةً، فتُعطَّل بعد التعيين (حالة واقعية: تعطيل لاحق).
        $list = PriceList::create(['name' => 'أسعار القناة '.Str::random(6), 'is_active' => true]);
        foreach ($prices as $productId => $price) {
            PriceListItem::create([
                'price_list_id' => $list->id, 'product_id' => $productId,
                'product_variant_id' => null, 'unit_name' => 'piece', 'price' => $price,
            ]);
        }
        $channel->update(['default_price_list_id' => $list->id]);
        if (! $active) {
            $list->update(['is_active' => false]);
        }

        app(TenantContext::class)->forget();

        return $list->fresh();
    }

    protected function makeOffer(string $tenantId, Storefront $storefront, Product $product, array $attrs = []): StorefrontOffer
    {
        app(TenantContext::class)->set($tenantId);

        $offer = StorefrontOffer::create(array_merge([
            'storefront_id' => $storefront->id, 'product_id' => $product->id,
        ], $attrs));

        app(TenantContext::class)->forget();

        return $offer->fresh();
    }

    /**
     * منتجٌ متعدد الخيارات بمتغيّرين، منشورٌ على القناة (نفس هيكل
     * `StorefrontVariantCommerceTest::variantManagedProduct()`).
     *
     * @return array{0: Product, 1: ProductVariant, 2: ProductVariant}
     */
    protected function variantOfferProduct(string $tenantId, SalesChannel $channel): array
    {
        app(TenantContext::class)->set($tenantId);

        $product = Product::create(['name' => 'قميص', 'sku' => 'SHIRT-'.Str::random(5), 'sale_price' => 20000, 'unit' => 'piece', 'is_active' => true]);

        $color = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();

        $v1 = $variants->createSingleVariant($product, [$black->id], null)['variant'];
        $v2 = $variants->createSingleVariant($product, [$white->id], null)['variant'];

        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);

        app(TenantContext::class)->forget();

        return [$product->fresh(), $v1->fresh(), $v2->fresh()];
    }
}
