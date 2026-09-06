<?php

namespace Tests\Feature;

use App\Models\InventoryStockAlert;
use App\Models\Notification;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * يثبت أن `InventoryService::applyReceipt/applyIssue/recordSaleCogs` تُطلق
 * تقييم تنبيه المخزون فعلياً بعد الترحيل الحقيقي — لا أن الخدمة الداخلية وحدها
 * صحيحة بمعزل عن نقاط التشغيل. أهمّ حالة هنا: معاملة متراجعة لا تُنشئ إشعاراً.
 */
class InventoryAlertTriggerTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected User $owner;
    protected Partner $customer;
    protected InventoryService $inventory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح',
            'slug' => 'nibras',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->owner = User::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'المالك',
            'email' => 'owner@nibras.test',
            'password' => 'password123',
            'role' => 'owner',
            'is_active' => true,
        ]);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);

        Settings::put('inventory', [
            'low_stock_notifications_enabled' => true,
            'out_of_stock_notifications_enabled' => true,
        ], $this->tenant);

        $this->inventory = app(InventoryService::class);
    }

    private function notificationsFor(Product $product): \Illuminate\Support\Collection
    {
        return Notification::query()->where('source_type', 'product')->where('source_id', $product->id)->get();
    }

    /** @test */
    public function receiving_stock_that_clears_the_reorder_level_resolves_an_active_low_stock_alert(): void
    {
        $product = Product::create(['name' => 'بضاعة', 'sale_price' => 10000, 'track_inventory' => true, 'quantity_on_hand' => 3, 'reorder_level' => 5]);
        app(\App\Services\Accounting\InventoryAlertService::class)->evaluateProduct($this->tenant->id, $product->id);
        $this->assertSame(InventoryStockAlert::STATUS_ACTIVE, InventoryStockAlert::where('product_id', $product->id)->first()->status);

        // استلام حقيقي عبر البوابة نفسها التي تستخدمها فاتورة المشتريات.
        $this->inventory->receiveStock($product, 20, 4000);

        $alert = InventoryStockAlert::where('product_id', $product->id)->first();
        $this->assertSame(InventoryStockAlert::STATUS_RESOLVED, $alert->status);
        $this->assertCount(1, $this->notificationsFor($product)); // لا إشعار جديد عند العودة للطبيعي
    }

    /** @test */
    public function selling_a_tracked_product_below_reorder_level_delivers_a_low_stock_notification(): void
    {
        $product = Product::create(['name' => 'بضاعة', 'sale_price' => 10000, 'track_inventory' => true, 'reorder_level' => 5]);
        $this->inventory->receiveStock($product, 10, 4000); // الكمية 10 — لا تنبيه بعد

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 7, 'unit_price' => 10000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($invoice); // الكمية تصبح 3 ≤ 5 → منخفض

        $product->refresh();
        $this->assertSame(3, $product->quantity_on_hand);
        $alert = InventoryStockAlert::where('product_id', $product->id)->first();
        $this->assertNotNull($alert);
        $this->assertSame(InventoryStockAlert::TYPE_LOW_STOCK, $alert->type);
        $this->assertCount(1, $this->notificationsFor($product));

        $notification = $this->notificationsFor($product)->first();
        $this->assertSame($this->owner->id, $notification->recipient_id);
        $this->assertSame('view_product', $notification->action);
        $this->assertSame('product', $notification->source_type);
        $this->assertSame($product->id, $notification->source_id);
    }

    /** @test */
    public function a_rolled_back_transaction_never_delivers_a_notification(): void
    {
        $product = Product::create(['name' => 'بضاعة', 'sale_price' => 10000, 'track_inventory' => true, 'quantity_on_hand' => 10, 'reorder_level' => 5]);

        try {
            DB::transaction(function () use ($product) {
                $this->inventory->applyIssue($product, 8, 4000); // 10 - 8 = 2 ≤ 5 → كان سيصبح منخفضاً
                throw new \RuntimeException('محاكاة فشل يوجب التراجع');
            });
        } catch (\RuntimeException) {
            // متوقَّع.
        }

        $product->refresh();
        $this->assertSame(10, $product->quantity_on_hand); // المعاملة تراجعت فعلاً
        $this->assertNull(InventoryStockAlert::where('product_id', $product->id)->first());
        $this->assertCount(0, $this->notificationsFor($product));
    }
}
