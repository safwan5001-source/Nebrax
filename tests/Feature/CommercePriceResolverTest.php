<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\FulfillmentPolicy;
use App\Models\Invoice;
use App\Models\InventoryReservation;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\Warehouse;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\ResolvedCommercePrice;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use ReflectionClass;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-4A — Commerce Price Resolution boundary
 * ═══════════════════════════════════════════════════════════════
 *  اقتراحٌ للقراءة فقط: يُنسِّق `PriceListService`/`PosCustomerPriceListResolver`/
 *  `UnitConversion`/`Product.sale_price` الموجودين، ولا يخزّن ولا يحسب ضريبة
 *  ولا يغيّر مخزوناً أو محاسبة. الأسبقية مطابقة حرفياً لـ`PosCustomerPriceListResolver::posPriceFor()`
 *  المُثبَتة فعلياً في `PosService::checkout()`.
 *
 *  تشغيل: php artisan test --filter=CommercePriceResolverTest
 */
class CommercePriceResolverTest extends TestCase
{
    use RefreshDatabase;

    private CommercePriceResolver $resolver;
    private Product $product;
    private SalesChannel $channel;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);

        $this->product = Product::create(['name' => 'منتج تسعير', 'sale_price' => 15000]);
        $this->channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا', 'type' => SalesChannel::TYPE_MOBILE]);
        $this->resolver = app(CommercePriceResolver::class);
    }

    private function activePriceList(string $name = 'قائمة كبار العملاء'): PriceList
    {
        return PriceList::create(['name' => $name, 'is_active' => true]);
    }

    private function partnerWithDefaultList(PriceList $priceList): Partner
    {
        return Partner::create([
            'name' => 'عميل تسعير', 'type' => 'customer', 'default_price_list_id' => $priceList->id,
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  Basic resolution
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function it_resolves_the_product_default_price_when_no_partner_is_given(): void
    {
        $result = $this->resolver->resolve($this->product->id, $this->channel->id);

        $this->assertTrue($result->resolved);
        $this->assertSame(15000, $result->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT, $result->source);
        $this->assertNull($result->priceListId);
    }

    /** @test */
    public function it_resolves_an_applicable_price_list_item_over_the_product_default(): void
    {
        $priceList = $this->activePriceList();
        app(PriceListService::class)->upsertItem($priceList, $this->product, ['price' => 12000]);
        $partner = $this->partnerWithDefaultList($priceList);

        $result = $this->resolver->resolve($this->product->id, $this->channel->id, $partner->id);

        $this->assertTrue($result->resolved);
        $this->assertSame(12000, $result->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRICE_LIST, $result->source);
        $this->assertSame($priceList->id, $result->priceListId);
    }

    /** @test */
    public function the_existing_precedence_falls_back_to_product_default_when_the_list_has_no_matching_item(): void
    {
        $priceList = $this->activePriceList();
        $partner = $this->partnerWithDefaultList($priceList);
        // لا عنصر في القائمة لهذا المنتج إطلاقاً.

        $result = $this->resolver->resolve($this->product->id, $this->channel->id, $partner->id);

        $this->assertSame(15000, $result->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT, $result->source);
    }

    /** @test */
    public function a_genuine_zero_price_is_distinguished_from_no_price_resolved(): void
    {
        $freeProduct = Product::create(['name' => 'منتج مجاني', 'sale_price' => 0]);

        $zero = $this->resolver->resolve($freeProduct->id, $this->channel->id);
        $this->assertTrue($zero->resolved, 'صفرٌ حقيقي — سعرٌ مُقرَّر، لا غياب سعر.');
        $this->assertSame(0, $zero->amount);

        // وحدة بديلة بلا سعرٍ صريح في أي قائمة ⇒ لا سعر قابل للحسم إطلاقاً.
        $template = UnitTemplate::create(['name' => 'قالب كراتين تسعير', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => 24]);
        $boxed = Product::create(['name' => 'منتج كراتين', 'unit' => 'piece', 'unit_template_id' => $template->id, 'sale_price' => 15000]);

        $none = $this->resolver->resolve($boxed->id, $this->channel->id, unitName: 'carton');
        $this->assertFalse($none->resolved, 'لا يُشتقّ سعر عبوة من معامل التحويل.');
        $this->assertNull($none->amount);
        $this->assertSame(ResolvedCommercePrice::SOURCE_NONE, $none->source);
    }

    /** @test */
    public function precision_is_preserved_exactly_for_large_halala_amounts(): void
    {
        $product = Product::create(['name' => 'منتج دقة', 'sale_price' => 123456789]);

        $result = $this->resolver->resolve($product->id, $this->channel->id);

        $this->assertSame(123456789, $result->amount);
        $this->assertIsInt($result->amount);
    }

    // ═══════════════════════════════════════════════════════════
    //  Customer / Partner pricing
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function existing_partner_default_price_list_behavior_is_preserved(): void
    {
        $priceList = $this->activePriceList();
        app(PriceListService::class)->upsertItem($priceList, $this->product, ['price' => 9900]);
        $partner = $this->partnerWithDefaultList($priceList);

        $result = $this->resolver->resolve($this->product->id, $this->channel->id, $partner->id);

        $this->assertSame(9900, $result->amount);
    }

    /** @test */
    public function an_inactive_partner_price_list_is_not_trusted_and_falls_back(): void
    {
        $priceList = $this->activePriceList();
        app(PriceListService::class)->upsertItem($priceList, $this->product, ['price' => 9900]);
        $partner = $this->partnerWithDefaultList($priceList);
        $priceList->update(['is_active' => false]);

        $result = $this->resolver->resolve($this->product->id, $this->channel->id, $partner->id);

        $this->assertSame(15000, $result->amount, 'قائمة معطّلة لا تُستعمل مباشرةً — نفس فحص PosCustomerPriceListResolver::forPartner().');
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRODUCT_DEFAULT, $result->source);
        $this->assertNull($result->priceListId);
    }

    /** @test */
    public function the_no_partner_path_works_without_any_partner_context(): void
    {
        $result = $this->resolver->resolve($this->product->id, $this->channel->id, partnerId: null);

        $this->assertTrue($result->resolved);
        $this->assertSame(15000, $result->amount);
    }

    // ═══════════════════════════════════════════════════════════
    //  Tenant isolation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_cross_tenant_product_is_rejected(): void
    {
        $foreignProductId = $this->product->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'other-cp-tenant-1']);
        app(TenantContext::class)->set($tenantB->id);
        $channelUnderB = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا ب', 'type' => SalesChannel::TYPE_MOBILE]);

        $this->expectException(RuntimeException::class);
        $this->resolver->resolve($foreignProductId, $channelUnderB->id);
    }

    /** @test */
    public function a_cross_tenant_sales_channel_is_rejected(): void
    {
        $foreignChannelId = $this->channel->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٢', 'slug' => 'other-cp-tenant-2']);
        app(TenantContext::class)->set($tenantB->id);
        $productUnderB = Product::create(['name' => 'منتج ب', 'sale_price' => 5000]);

        $this->expectException(RuntimeException::class);
        $this->resolver->resolve($productUnderB->id, $foreignChannelId);
    }

    /** @test */
    public function a_cross_tenant_partner_is_rejected(): void
    {
        $foreignPartnerId = $this->partnerWithDefaultList($this->activePriceList())->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٣', 'slug' => 'other-cp-tenant-3']);
        app(TenantContext::class)->set($tenantB->id);
        $productUnderB = Product::create(['name' => 'منتج ب ٢', 'sale_price' => 5000]);
        $channelUnderB = SalesChannel::create(['slug' => 'mobile', 'name' => 'قناة ب', 'type' => SalesChannel::TYPE_MOBILE]);

        $this->expectException(RuntimeException::class);
        $this->resolver->resolve($productUnderB->id, $channelUnderB->id, $foreignPartnerId);
    }

    /** @test */
    public function a_price_list_never_leaks_across_tenants_even_with_identical_names(): void
    {
        $priceListA = $this->activePriceList('قائمة مشتركة الاسم');
        app(PriceListService::class)->upsertItem($priceListA, $this->product, ['price' => 11000]);
        $partnerA = $this->partnerWithDefaultList($priceListA);

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٤', 'slug' => 'other-cp-tenant-4']);
        app(TenantContext::class)->set($tenantB->id);
        $productB = Product::create(['name' => 'منتج ب ٣', 'sale_price' => 7000]);
        $channelB = SalesChannel::create(['slug' => 'mobile', 'name' => 'قناة ب ٢', 'type' => SalesChannel::TYPE_MOBILE]);
        $priceListB = $this->activePriceList('قائمة مشتركة الاسم');
        app(PriceListService::class)->upsertItem($priceListB, $productB, ['price' => 6500]);
        $partnerB = $this->partnerWithDefaultList($priceListB);

        $resultB = $this->resolver->resolve($productB->id, $channelB->id, $partnerB->id);

        $this->assertSame(6500, $resultB->amount, 'لا يتسرّب سعر مستأجر أ رغم تطابق اسم القائمة.');
        $this->assertSame($priceListB->id, $resultB->priceListId);
        $this->assertNotSame($priceListA->id, $resultB->priceListId);
    }

    // ═══════════════════════════════════════════════════════════
    //  UOM
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_alternative_unit_with_an_explicit_price_list_item_resolves_correctly(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب كراتين UOM', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => 24]);
        $boxed = Product::create(['name' => 'منتج UOM', 'unit' => 'piece', 'unit_template_id' => $template->id, 'sale_price' => 500]);

        $priceList = $this->activePriceList();
        app(PriceListService::class)->upsertItem($priceList, $boxed, ['unit_name' => 'carton', 'price' => 10800]);
        $partner = $this->partnerWithDefaultList($priceList);

        $result = $this->resolver->resolve($boxed->id, $this->channel->id, $partner->id, unitName: 'carton');

        $this->assertTrue($result->resolved);
        $this->assertSame(10800, $result->amount);
        $this->assertSame('carton', $result->unitName);
        $this->assertSame(ResolvedCommercePrice::SOURCE_PRICE_LIST, $result->source);
    }

    /** @test */
    public function an_undefined_unit_is_rejected(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب UOM غير معرَّف', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => 24]);
        $boxed = Product::create(['name' => 'منتج UOM ٢', 'unit' => 'piece', 'unit_template_id' => $template->id, 'sale_price' => 500]);

        $this->expectException(RuntimeException::class);
        $this->resolver->resolve($boxed->id, $this->channel->id, unitName: 'pallet-not-defined');
    }

    // ═══════════════════════════════════════════════════════════
    //  Boundaries
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function resolving_a_price_creates_no_commerce_listing_or_fulfillment_policy(): void
    {
        $this->resolver->resolve($this->product->id, $this->channel->id);

        $this->assertSame(0, CommerceListing::count());
        $this->assertSame(0, FulfillmentPolicy::count());
    }

    /** @test */
    public function resolving_a_price_creates_no_inventory_reservation_or_stock_movement(): void
    {
        $this->resolver->resolve($this->product->id, $this->channel->id);

        $this->assertSame(0, InventoryReservation::count());
        $this->assertSame(0, StockMovement::count());
    }

    /** @test */
    public function resolving_a_price_never_changes_available_to_sell(): void
    {
        $warehouse = Warehouse::create(['name' => 'مخزن تسعير', 'code' => 'CP-W1']);
        ProductWarehouseStock::create(['product_id' => $this->product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10]);

        $before = app(AvailableToSellService::class)->forWarehouse($this->product->id, $warehouse->id);
        $this->resolver->resolve($this->product->id, $this->channel->id);
        $after = app(AvailableToSellService::class)->forWarehouse($this->product->id, $warehouse->id);

        $this->assertSame($before->onHand, $after->onHand);
        $this->assertSame($before->availableToSell, $after->availableToSell);
    }

    /** @test */
    public function resolving_a_price_creates_no_accounting_or_zatca_side_effect(): void
    {
        $this->resolver->resolve($this->product->id, $this->channel->id);

        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, Invoice::count(), 'لا Invoice ⇐ لا سطح ZATCA (QR/UUID/ICV) يمكن أن يتأثر.');
        $this->assertSame(0, Payment::count());
    }

    /** @test */
    public function resolving_a_price_persists_nothing_and_the_price_list_item_count_is_unchanged(): void
    {
        $priceList = $this->activePriceList();
        app(PriceListService::class)->upsertItem($priceList, $this->product, ['price' => 12000]);
        $partner = $this->partnerWithDefaultList($priceList);
        $before = PriceListItem::count();

        $this->resolver->resolve($this->product->id, $this->channel->id, $partner->id);

        $this->assertSame($before, PriceListItem::count());
    }

    /** @test */
    public function the_dto_never_exposes_cost_or_margin_fields(): void
    {
        $properties = (new ReflectionClass(ResolvedCommercePrice::class))->getProperties();
        $names = array_map(fn ($p) => $p->getName(), $properties);

        foreach (['cost', 'avg_cost', 'avgCost', 'purchase_cost', 'purchasePrice', 'margin', 'account', 'internal_notes'] as $sensitive) {
            $this->assertNotContains($sensitive, $names, "«{$sensitive}» يجب ألا يظهر في DTO عام التصميم.");
        }
    }
}
