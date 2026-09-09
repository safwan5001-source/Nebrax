<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InventoryReservation;
use App\Models\JournalEntry;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-2A — Sales Channel foundation (ADR-03)
 * ═══════════════════════════════════════════════════════════════
 *  القناة تجيب «من أي قناة تجارية جاء البيع؟» فقط — لا فرع، لا مخزن، لا أثر
 *  محاسبي أو مخزني. Fulfillment Policy (PR-COM-2B) تربطها لاحقاً بمخزن؛ هذا
 *  الملف يثبت أن القناة اليوم لا تحتاج أياً منهما ولا تلمسهما.
 *
 *  تشغيل: php artisan test --filter=SalesChannelTest
 */
class SalesChannelTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    /** @test */
    public function a_sales_channel_can_be_created_for_a_tenant(): void
    {
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'متجر أَوْج', 'type' => SalesChannel::TYPE_WEB,
        ]);

        $this->assertSame($this->tenant->id, $channel->tenant_id);
        $this->assertSame('web', $channel->slug);
        $this->assertTrue($channel->is_active, 'نشطة افتراضياً.');
    }

    /** @test */
    public function tenant_scope_isolates_sales_channels(): void
    {
        SalesChannel::create(['slug' => 'web', 'name' => 'متجر', 'type' => SalesChannel::TYPE_WEB]);

        $tenantB = Tenant::create(['name' => 'شركة أخرى', 'slug' => 'other-sc-tenant']);
        app(TenantContext::class)->set($tenantB->id);

        $this->assertSame(0, SalesChannel::count(), 'مستأجر ب لا يرى قناة مستأجر أ.');
    }

    /** @test */
    public function the_same_slug_is_allowed_across_two_tenants(): void
    {
        $channelA = SalesChannel::create(['slug' => 'web', 'name' => 'متجر أ', 'type' => SalesChannel::TYPE_WEB]);

        $tenantB = Tenant::create(['name' => 'شركة أخرى ٢', 'slug' => 'other-sc-tenant-2']);
        app(TenantContext::class)->set($tenantB->id);
        $channelB = SalesChannel::create(['slug' => 'web', 'name' => 'متجر ب', 'type' => SalesChannel::TYPE_WEB]);

        $this->assertNotSame($channelA->id, $channelB->id);
        $this->assertSame('web', $channelA->slug);
        $this->assertSame('web', $channelB->slug);
    }

    /** @test */
    public function a_duplicate_slug_within_the_same_tenant_is_rejected(): void
    {
        SalesChannel::create(['slug' => 'web', 'name' => 'متجر', 'type' => SalesChannel::TYPE_WEB]);

        $this->expectException(QueryException::class);
        SalesChannel::create(['slug' => 'web', 'name' => 'متجر آخر بنفس المعرّف', 'type' => SalesChannel::TYPE_WEB]);
    }

    /** @test */
    public function a_channel_can_be_deactivated_and_reactivated(): void
    {
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا', 'type' => SalesChannel::TYPE_MOBILE]);

        $channel->update(['is_active' => false]);
        $this->assertFalse($channel->fresh()->is_active);

        $channel->update(['is_active' => true]);
        $this->assertTrue($channel->fresh()->is_active);
    }

    /** @test */
    public function a_channel_does_not_require_a_branch(): void
    {
        $this->assertNotContains('branch_id', (new SalesChannel())->getFillable());

        $channel = SalesChannel::create(['slug' => 'pos', 'name' => 'نقطة بيع', 'type' => SalesChannel::TYPE_POS]);
        $this->assertFalse($channel->offsetExists('branch_id'));
    }

    /** @test */
    public function a_channel_does_not_require_a_warehouse(): void
    {
        $this->assertNotContains('warehouse_id', (new SalesChannel())->getFillable());

        $channel = SalesChannel::create(['slug' => 'external-1', 'name' => 'سلة', 'type' => SalesChannel::TYPE_EXTERNAL]);
        $this->assertFalse($channel->offsetExists('warehouse_id'));
    }

    /** @test */
    public function creating_and_toggling_a_channel_mutates_no_inventory_reservation(): void
    {
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'متجر', 'type' => SalesChannel::TYPE_WEB]);
        $channel->update(['is_active' => false]);

        $this->assertSame(0, InventoryReservation::count());
    }

    /** @test */
    public function creating_and_toggling_a_channel_creates_no_stock_movement(): void
    {
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'متجر', 'type' => SalesChannel::TYPE_WEB]);
        $channel->update(['is_active' => false]);

        $this->assertSame(0, StockMovement::count());
    }

    /** @test */
    public function creating_and_toggling_a_channel_creates_no_accounting_entry(): void
    {
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'متجر', 'type' => SalesChannel::TYPE_WEB]);
        $channel->update(['is_active' => false]);

        $this->assertSame(0, JournalEntry::count());
    }

    /** @test */
    public function creating_and_toggling_a_channel_creates_no_invoice_or_zatca_artifact(): void
    {
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'متجر', 'type' => SalesChannel::TYPE_WEB]);
        $channel->update(['is_active' => false]);

        $this->assertSame(0, Invoice::count());
    }

    /** @test */
    public function an_invalid_type_is_rejected_by_the_schema(): void
    {
        $this->expectException(QueryException::class);
        SalesChannel::create(['slug' => 'invalid-type', 'name' => 'قناة غير صالحة', 'type' => 'marketplace']);
    }
}
