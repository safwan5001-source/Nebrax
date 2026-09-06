<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\InventoryStockAlert;
use App\Models\JournalEntry;
use App\Models\Notification;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\InventoryAlertService;
use App\Support\ProductListFilters;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * تنبيهات المخزون (PR-NOTIF-3): الحدود، الدورة، التفرّد، العزل، والمستلمون.
 * انظر docs/plans/alerts-notifications/AWJ_ALERTS_NOTIFICATIONS_MASTER_PLAN.md §5.3.
 */
class InventoryAlertServiceTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected User $owner;
    protected InventoryAlertService $alerts;

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

        $this->owner = User::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'المالك',
            'email' => 'owner@nibras.test',
            'password' => 'password123',
            'role' => 'owner',
            'is_active' => true,
        ]);

        Settings::put('inventory', [
            'low_stock_notifications_enabled' => true,
            'out_of_stock_notifications_enabled' => true,
        ], $this->tenant);

        $this->alerts = app(InventoryAlertService::class);
    }

    private function product(array $overrides = []): Product
    {
        return Product::create(array_merge([
            'name' => 'زيت محرك',
            'sale_price' => 5000,
            'track_inventory' => true,
            'quantity_on_hand' => 10,
            'reorder_level' => 5,
        ], $overrides));
    }

    private function notificationsFor(Product $product): \Illuminate\Support\Collection
    {
        return Notification::query()
            ->where('tenant_id', $this->tenant->id)
            ->where('source_type', 'product')
            ->where('source_id', $product->id)
            ->get();
    }

    /** @test */
    public function low_stock_boundary_is_exact_at_quantity_equal_reorder_level(): void
    {
        $atBoundary = $this->product(['quantity_on_hand' => 5, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $atBoundary->id);
        $alert = InventoryStockAlert::where('product_id', $atBoundary->id)->first();
        $this->assertNotNull($alert);
        $this->assertSame(InventoryStockAlert::TYPE_LOW_STOCK, $alert->type);

        $aboveBoundary = $this->product(['quantity_on_hand' => 6, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $aboveBoundary->id);
        $this->assertNull(InventoryStockAlert::where('product_id', $aboveBoundary->id)->first());
    }

    /** @test */
    public function non_positive_reorder_level_never_creates_low_stock(): void
    {
        $product = $this->product(['quantity_on_hand' => 1, 'reorder_level' => 0]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $this->assertNull(InventoryStockAlert::where('product_id', $product->id)->first());

        $negativeReorder = $this->product(['quantity_on_hand' => 1, 'reorder_level' => -5]);
        $this->alerts->evaluateProduct($this->tenant->id, $negativeReorder->id);
        $this->assertNull(InventoryStockAlert::where('product_id', $negativeReorder->id)->first());
    }

    /** @test */
    public function zero_or_negative_tracked_quantity_is_out_of_stock_not_low_stock(): void
    {
        $zero = $this->product(['quantity_on_hand' => 0, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $zero->id);
        $this->assertSame(InventoryStockAlert::TYPE_OUT_OF_STOCK, InventoryStockAlert::where('product_id', $zero->id)->first()->type);

        $negative = $this->product(['quantity_on_hand' => -3, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $negative->id);
        $this->assertSame(InventoryStockAlert::TYPE_OUT_OF_STOCK, InventoryStockAlert::where('product_id', $negative->id)->first()->type);
    }

    /** @test */
    public function untracked_products_never_create_alerts(): void
    {
        $product = $this->product(['track_inventory' => false, 'quantity_on_hand' => 0, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $this->assertNull(InventoryStockAlert::where('product_id', $product->id)->first());
        $this->assertCount(0, $this->notificationsFor($product));
    }

    /** @test */
    public function unchanged_condition_does_not_duplicate_alert_or_notification(): void
    {
        $product = $this->product(['quantity_on_hand' => 3, 'reorder_level' => 5]);

        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);

        $this->assertSame(1, InventoryStockAlert::where('product_id', $product->id)->count());
        $this->assertCount(1, $this->notificationsFor($product));
    }

    /** @test */
    public function concurrent_or_retried_evaluation_is_idempotent(): void
    {
        // يحاكي إعادة محاولة/سباقاً حميداً: استدعاءان متتاليان لنفس الحالة دون
        // تغيّر بينهما — النتيجة صفّ واحد وإشعار واحد كما في الاختبار أعلاه،
        // لكن هنا نتحقق أيضاً أن معرّف صفّ التنبيه لا يتغيّر بين الاستدعاءين.
        $product = $this->product(['quantity_on_hand' => 0, 'reorder_level' => 5]);

        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $first = InventoryStockAlert::where('product_id', $product->id)->first();

        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $second = InventoryStockAlert::where('product_id', $product->id)->first();

        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, InventoryStockAlert::where('product_id', $product->id)->count());
        $this->assertCount(1, $this->notificationsFor($product));
    }

    /** @test */
    public function low_to_out_of_stock_delivers_one_new_meaningful_notification(): void
    {
        $product = $this->product(['quantity_on_hand' => 3, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $this->assertCount(1, $this->notificationsFor($product));

        $product->update(['quantity_on_hand' => 0]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);

        $notifications = $this->notificationsFor($product);
        $this->assertCount(2, $notifications);
        $this->assertSame('inventory.low_stock', $notifications->first()->type);
        $this->assertSame('inventory.out_of_stock', $notifications->last()->type);

        $alert = InventoryStockAlert::where('product_id', $product->id)->first();
        $this->assertSame(InventoryStockAlert::TYPE_OUT_OF_STOCK, $alert->type);
        $this->assertSame(1, $alert->cycle); // نفس الدورة — لم يُحلّ بينهما
    }

    /** @test */
    public function recovery_resolves_the_alert_without_altering_notification_history(): void
    {
        $product = $this->product(['quantity_on_hand' => 3, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $notification = $this->notificationsFor($product)->first();
        $notification->update(['read_at' => now()]); // المستخدم قرأ الإشعار

        $product->update(['quantity_on_hand' => 50]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);

        $alert = InventoryStockAlert::where('product_id', $product->id)->first();
        $this->assertSame(InventoryStockAlert::STATUS_RESOLVED, $alert->status);
        $this->assertNotNull($alert->resolved_at);

        // لا إشعار جديد عند العودة إلى الطبيعي، والإشعار القديم يبقى بحالته كما هو.
        $this->assertCount(1, $this->notificationsFor($product));
        $notification->refresh();
        $this->assertNotNull($notification->read_at);
    }

    /** @test */
    public function recovery_then_a_later_drop_starts_a_new_cycle_and_notifies_again(): void
    {
        $product = $this->product(['quantity_on_hand' => 3, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);

        $product->update(['quantity_on_hand' => 50]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);

        $product->update(['quantity_on_hand' => 2]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);

        $alert = InventoryStockAlert::where('product_id', $product->id)->first();
        $this->assertSame(InventoryStockAlert::STATUS_ACTIVE, $alert->status);
        $this->assertSame(2, $alert->cycle);
        $this->assertCount(2, $this->notificationsFor($product));
    }

    /** @test */
    public function tenant_isolation_keeps_alerts_and_notifications_separate(): void
    {
        $productA = $this->product(['quantity_on_hand' => 0, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $productA->id);

        $tenantB = Tenant::create(['name' => 'مستأجر ب', 'slug' => 'tenant-b', 'vat_number' => '300000000000004', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenantB->id);
        User::create(['tenant_id' => $tenantB->id, 'name' => 'مالك ب', 'email' => 'ownerb@nibras.test', 'password' => 'password123', 'role' => 'owner', 'is_active' => true]);
        Settings::put('inventory', ['low_stock_notifications_enabled' => true, 'out_of_stock_notifications_enabled' => true], $tenantB);
        $productB = Product::create(['tenant_id' => $tenantB->id, 'name' => 'زيت محرك', 'sale_price' => 5000, 'track_inventory' => true, 'quantity_on_hand' => 0, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($tenantB->id, $productB->id);

        // استعلامات صريحة النطاق (بلا اعتماد على TenantContext النشط حالياً) —
        // تثبت عزل الصفوف فعلياً بصرف النظر عن أي مستأجر مضبوط وقت الفحص.
        $this->assertSame(1, InventoryStockAlert::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->count());
        $this->assertSame(1, InventoryStockAlert::withoutGlobalScopes()->where('tenant_id', $tenantB->id)->count());
        $this->assertSame(1, Notification::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->count());
        $this->assertSame(1, Notification::withoutGlobalScopes()->where('tenant_id', $tenantB->id)->count());

        // مستأجر لا يرى تنبيهات أو إشعارات الآخر عبر نفس معرّف المنتج المتشابه بالاسم
        // حتى مع TenantScope النشط فعلياً (لا استعلام يدوي متجاوز هنا).
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertNull(InventoryStockAlert::where('product_id', $productB->id)->first());
    }

    /** @test */
    public function only_users_with_manage_permission_and_branch_visibility_are_notified(): void
    {
        $mainBranch = Branch::create(['tenant_id' => $this->tenant->id, 'code' => 'B1', 'name' => 'الفرع الرئيسي', 'is_main' => true]);
        $otherBranch = Branch::create(['tenant_id' => $this->tenant->id, 'code' => 'B2', 'name' => 'فرع آخر']);

        // staff بلا صلاحية إدارة المنتجات — لا يصله الإشعار رغم كونه نشطاً.
        $staffWithoutPermission = User::create(['tenant_id' => $this->tenant->id, 'name' => 'موظف', 'email' => 'staff@nibras.test', 'password' => 'password123', 'role' => 'staff', 'is_active' => true]);

        // مدير مقيَّد بفرع آخر غير فرع المنتج — لا يصله الإشعار.
        $restrictedAdmin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'مدير مقيَّد', 'email' => 'restricted@nibras.test', 'password' => 'password123', 'role' => 'admin', 'is_active' => true]);
        $restrictedAdmin->branches()->attach($otherBranch->id);

        // مدير غير مقيَّد بأي فرع — يصله الإشعار.
        $unrestrictedAdmin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'مدير', 'email' => 'admin@nibras.test', 'password' => 'password123', 'role' => 'admin', 'is_active' => true]);

        $product = $this->product(['branch_id' => $mainBranch->id, 'quantity_on_hand' => 0, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);

        $recipients = $this->notificationsFor($product)->pluck('recipient_id')->all();

        $this->assertNotContains($staffWithoutPermission->id, $recipients);
        $this->assertNotContains($restrictedAdmin->id, $recipients);
        $this->assertContains($unrestrictedAdmin->id, $recipients);
        $this->assertContains($this->owner->id, $recipients); // المالك غير مقيَّد بأي فرع افتراضياً
    }

    /** @test */
    public function branch_less_product_is_visible_to_a_branch_restricted_user_too(): void
    {
        $branch = Branch::create(['tenant_id' => $this->tenant->id, 'code' => 'B1', 'name' => 'الفرع الرئيسي', 'is_main' => true]);
        $restrictedAdmin = User::create(['tenant_id' => $this->tenant->id, 'name' => 'مدير مقيَّد', 'email' => 'restricted2@nibras.test', 'password' => 'password123', 'role' => 'admin', 'is_active' => true]);
        $restrictedAdmin->branches()->attach($branch->id);

        $sharedProduct = $this->product(['branch_id' => null, 'quantity_on_hand' => 0, 'reorder_level' => 5]);
        $this->alerts->evaluateProduct($this->tenant->id, $sharedProduct->id);

        $recipients = $this->notificationsFor($sharedProduct)->pluck('recipient_id')->all();
        $this->assertContains($restrictedAdmin->id, $recipients);
    }

    /** @test */
    public function disabled_tenant_setting_suppresses_delivery(): void
    {
        Settings::put('inventory', ['low_stock_notifications_enabled' => false], $this->tenant);
        $product = $this->product(['quantity_on_hand' => 3, 'reorder_level' => 5]);

        $this->alerts->evaluateProduct($this->tenant->id, $product->id);

        $this->assertNull(InventoryStockAlert::where('product_id', $product->id)->first());
        $this->assertCount(0, $this->notificationsFor($product));

        Settings::put('inventory', ['low_stock_notifications_enabled' => true], $this->tenant);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $this->assertCount(1, $this->notificationsFor($product));
    }

    /** @test */
    public function notification_payload_never_leaks_cost_or_purchase_price(): void
    {
        $product = $this->product(['quantity_on_hand' => 0, 'reorder_level' => 5, 'purchase_price' => 12345, 'avg_cost' => 9999]);
        $this->alerts->evaluateProduct($this->tenant->id, $product->id);

        $notification = $this->notificationsFor($product)->first();
        $this->assertNotNull($notification);
        $this->assertArrayNotHasKey('avg_cost', $notification->data);
        $this->assertArrayNotHasKey('purchase_price', $notification->data);
        $this->assertArrayNotHasKey('cost', $notification->data);
        $this->assertStringNotContainsString('12345', $notification->message);
        $this->assertStringNotContainsString('9999', $notification->message);
        $this->assertSame(['quantity_on_hand', 'reorder_level'], array_keys($notification->data));
    }

    /** @test */
    public function service_condition_matches_product_list_filters_stock_state(): void
    {
        $cases = [
            ['quantity_on_hand' => 5, 'reorder_level' => 5, 'expected' => 'low'],
            ['quantity_on_hand' => 6, 'reorder_level' => 5, 'expected' => 'normal'],
            ['quantity_on_hand' => 0, 'reorder_level' => 5, 'expected' => 'out'],
            ['quantity_on_hand' => 0, 'reorder_level' => 0, 'expected' => 'out'],
            ['quantity_on_hand' => 1, 'reorder_level' => 0, 'expected' => 'normal'],
        ];

        foreach ($cases as $case) {
            $product = $this->product(['quantity_on_hand' => $case['quantity_on_hand'], 'reorder_level' => $case['reorder_level']]);

            $matchesLowFilter = Product::query()->whereKey($product->id)
                ->tap(fn ($query) => ProductListFilters::apply($query, ['stock_state' => 'low']))
                ->exists();
            $matchesOutFilter = Product::query()->whereKey($product->id)
                ->tap(fn ($query) => ProductListFilters::apply($query, ['stock_state' => 'out']))
                ->exists();

            $this->alerts->evaluateProduct($this->tenant->id, $product->id);
            $alert = InventoryStockAlert::where('product_id', $product->id)->first();

            match ($case['expected']) {
                'low' => [
                    $this->assertTrue($matchesLowFilter, 'ProductListFilters should classify this row as low'),
                    $this->assertSame(InventoryStockAlert::TYPE_LOW_STOCK, $alert?->type),
                ],
                'out' => [
                    $this->assertTrue($matchesOutFilter, 'ProductListFilters should classify this row as out'),
                    $this->assertSame(InventoryStockAlert::TYPE_OUT_OF_STOCK, $alert?->type),
                ],
                'normal' => [
                    $this->assertFalse($matchesLowFilter),
                    $this->assertFalse($matchesOutFilter),
                    $this->assertNull($alert),
                ],
            };
        }
    }

    /** @test */
    public function evaluation_never_modifies_stock_quantity_valuation_or_accounting_entries(): void
    {
        $product = $this->product(['quantity_on_hand' => 3, 'reorder_level' => 5, 'avg_cost' => 777]);
        $journalCountBefore = JournalEntry::count();

        $this->alerts->evaluateProduct($this->tenant->id, $product->id);
        $this->alerts->scanTenant($this->tenant->id);

        $product->refresh();
        $this->assertSame(3, $product->quantity_on_hand);
        $this->assertSame(777, $product->avg_cost);
        $this->assertSame($journalCountBefore, JournalEntry::count());
    }
}
