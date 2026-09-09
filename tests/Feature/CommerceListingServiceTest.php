<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\FulfillmentPolicy;
use App\Models\Invoice;
use App\Models\InventoryReservation;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Commerce\AvailableToSellService;
use App\Services\Commerce\CommerceListingService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-3 — Commerce Listing foundation (Master Plan §PHASE 3)
 * ═══════════════════════════════════════════════════════════════
 *  عرضٌ تجاري لمنتج على قناة — لا سعر، لا مخزون/ATS، لا مخزن تنفيذ، لا أثر
 *  محاسبي. تجاوزات العرض اختيارية بلا نسخ من المنتج؛ الغياب يعني «استخدم
 *  عرض المنتج الافتراضي».
 *
 *  تشغيل: php artisan test --filter=CommerceListingServiceTest
 */
class CommerceListingServiceTest extends TestCase
{
    use RefreshDatabase;

    private CommerceListingService $listings;
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

        $this->product = Product::create(['name' => 'منتج عرض', 'description' => 'وصف المنتج الأصلي']);
        $this->channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا', 'type' => SalesChannel::TYPE_MOBILE]);
        $this->listings = app(CommerceListingService::class);
    }

    // ═══════════════════════════════════════════════════════════
    //  Domain
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_same_tenant_product_and_channel_can_create_a_listing(): void
    {
        $listing = $this->listings->configure($this->product->id, $this->channel->id);

        $this->assertSame($this->product->id, $listing->product_id);
        $this->assertSame($this->channel->id, $listing->sales_channel_id);
        $this->assertFalse($listing->is_published, 'غير منشورة افتراضياً.');
    }

    /** @test */
    public function a_product_and_channel_never_produce_more_than_one_listing(): void
    {
        $this->listings->configure($this->product->id, $this->channel->id, ['title' => 'الأول']);
        $second = $this->listings->configure($this->product->id, $this->channel->id, ['title' => 'الثاني']);

        $this->assertSame(1, CommerceListing::count());
        $this->assertSame('الثاني', $second->title);
    }

    /** @test */
    public function the_one_listing_per_product_channel_invariant_is_enforced_at_the_database_level(): void
    {
        CommerceListing::create(['product_id' => $this->product->id, 'sales_channel_id' => $this->channel->id]);

        $this->expectException(QueryException::class);
        CommerceListing::create(['product_id' => $this->product->id, 'sales_channel_id' => $this->channel->id]);
    }

    /** @test */
    public function presentation_fields_are_stored_and_updated_independently(): void
    {
        $this->listings->configure($this->product->id, $this->channel->id, ['title' => 'عنوان القناة']);
        $listing = $this->listings->configure($this->product->id, $this->channel->id, ['description' => 'وصف القناة']);

        $this->assertSame('عنوان القناة', $listing->title, 'ضبط الوصف لا يمحو عنواناً سُبط سابقاً.');
        $this->assertSame('وصف القناة', $listing->description);
    }

    /** @test */
    public function publication_state_toggles_independently_of_presentation(): void
    {
        $listing = $this->listings->configure($this->product->id, $this->channel->id, ['title' => 'عنوان']);

        $listing->update(['is_published' => true]);
        $this->assertTrue($listing->fresh()->is_published);

        $listing->update(['is_published' => false]);
        $this->assertFalse($listing->fresh()->is_published);
    }

    /** @test */
    public function display_title_and_description_fall_back_to_the_product_when_no_override_is_set(): void
    {
        $listing = $this->listings->configure($this->product->id, $this->channel->id);

        $this->assertSame($this->product->name, $listing->displayTitle());
        $this->assertSame($this->product->description, $listing->displayDescription());
    }

    /** @test */
    public function display_title_and_description_prefer_the_channel_override_when_set(): void
    {
        $listing = $this->listings->configure($this->product->id, $this->channel->id, [
            'title' => 'اسم مخصص للقناة', 'description' => 'وصف مخصص للقناة',
        ]);

        $this->assertSame('اسم مخصص للقناة', $listing->displayTitle());
        $this->assertSame('وصف مخصص للقناة', $listing->displayDescription());
    }

    // ═══════════════════════════════════════════════════════════
    //  Tenant isolation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_cross_tenant_product_is_rejected(): void
    {
        $foreignProductId = $this->product->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'other-cl-tenant-1']);
        app(TenantContext::class)->set($tenantB->id);
        $channelUnderB = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا ب', 'type' => SalesChannel::TYPE_MOBILE]);

        $this->expectException(RuntimeException::class);
        $this->listings->configure($foreignProductId, $channelUnderB->id);
    }

    /** @test */
    public function a_cross_tenant_channel_is_rejected(): void
    {
        $foreignChannelId = $this->channel->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٢', 'slug' => 'other-cl-tenant-2']);
        app(TenantContext::class)->set($tenantB->id);
        $productUnderB = Product::create(['name' => 'منتج ب']);

        $this->expectException(RuntimeException::class);
        $this->listings->configure($productUnderB->id, $foreignChannelId);
    }

    /** @test */
    public function a_listing_is_hidden_from_another_tenant(): void
    {
        $this->listings->configure($this->product->id, $this->channel->id);

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٣', 'slug' => 'other-cl-tenant-3']);
        app(TenantContext::class)->set($tenantB->id);

        $this->assertSame(0, CommerceListing::count());
    }

    /** @test */
    public function cross_tenant_mutation_is_rejected(): void
    {
        $this->listings->configure($this->product->id, $this->channel->id);
        $foreignProductId = $this->product->id;
        $foreignChannelId = $this->channel->id;

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٤', 'slug' => 'other-cl-tenant-4']);
        app(TenantContext::class)->set($tenantB->id);

        $this->expectException(RuntimeException::class);
        $this->listings->configure($foreignProductId, $foreignChannelId, ['title' => 'محاولة تعديل من مستأجر آخر']);
    }

    // ═══════════════════════════════════════════════════════════
    //  Channel / Product lifecycle
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function disabling_a_channel_does_not_delete_or_alter_its_listings(): void
    {
        $listing = $this->listings->configure($this->product->id, $this->channel->id, ['title' => 'عنوان']);
        $listing->update(['is_published' => true]);

        $this->channel->update(['is_active' => false]);

        $listing->refresh();
        $this->assertSame(1, CommerceListing::count(), 'تعطيل القناة لا يحذف عروضها.');
        $this->assertSame('عنوان', $listing->title, 'ولا يغيّر بياناتها.');
        $this->assertTrue($listing->is_published, 'ولا حالة نشرها.');
    }

    /** @test */
    public function an_inactive_product_can_still_carry_a_listing_configuration(): void
    {
        $this->product->update(['is_active' => false]);

        // القرار: نشر العرض منفصلٌ عن صلاحية المنتج التشغيلية للبيع — لا
        // resolver شامل هنا (§17). التهيئة تنجح رغم تعطيل المنتج.
        $listing = $this->listings->configure($this->product->id, $this->channel->id);

        $this->assertNotNull($listing->id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Boundaries
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function configuring_a_listing_creates_no_inventory_reservation_or_stock_movement(): void
    {
        $this->listings->configure($this->product->id, $this->channel->id);

        $this->assertSame(0, InventoryReservation::count());
        $this->assertSame(0, StockMovement::count());
    }

    /** @test */
    public function configuring_a_listing_never_mutates_product_warehouse_stock_quantity(): void
    {
        $warehouse = Warehouse::create(['name' => 'مخزن CL', 'code' => 'CL-W1']);
        ProductWarehouseStock::create(['product_id' => $this->product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10]);

        $this->listings->configure($this->product->id, $this->channel->id);

        $this->assertSame(
            10,
            (int) ProductWarehouseStock::where('product_id', $this->product->id)
                ->where('warehouse_id', $warehouse->id)->value('quantity')
        );
    }

    /** @test */
    public function configuring_a_listing_never_changes_available_to_sell(): void
    {
        $warehouse = Warehouse::create(['name' => 'مخزن CL ATS', 'code' => 'CL-W2']);
        ProductWarehouseStock::create(['product_id' => $this->product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10]);

        $before = app(AvailableToSellService::class)->forWarehouse($this->product->id, $warehouse->id);
        $this->listings->configure($this->product->id, $this->channel->id);
        $after = app(AvailableToSellService::class)->forWarehouse($this->product->id, $warehouse->id);

        $this->assertSame($before->onHand, $after->onHand);
        $this->assertSame($before->availableToSell, $after->availableToSell);
    }

    /** @test */
    public function configuring_a_listing_creates_no_accounting_entries(): void
    {
        $this->listings->configure($this->product->id, $this->channel->id);

        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, Payment::count());
    }

    /** @test */
    public function configuring_a_listing_has_no_zatca_effect(): void
    {
        $this->listings->configure($this->product->id, $this->channel->id);

        // لا Invoice على الإطلاق ⇐ لا يوجد سطح ZATCA (QR/UUID/ICV) يمكن أن يتأثر.
        $this->assertSame(0, Invoice::count());
    }

    /** @test */
    public function configuring_a_listing_never_mutates_price_list_items(): void
    {
        $this->listings->configure($this->product->id, $this->channel->id);

        $this->assertSame(0, PriceListItem::count());
    }

    /** @test */
    public function configuring_a_listing_never_creates_a_fulfillment_policy(): void
    {
        $this->listings->configure($this->product->id, $this->channel->id);

        $this->assertSame(0, FulfillmentPolicy::count());
    }
}
