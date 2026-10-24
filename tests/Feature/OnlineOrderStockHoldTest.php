<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\PaymentAttempt;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Warehouse;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Services\Commerce\CommerceUnpaidOrderSweeper;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Support\CommercePaymentHold;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * H4-02 / D-14 — حجز مخزون الطلب الإلكتروني (60 دقيقة افتراضياً، قابلة للضبط) والتحرير الآمن بعد التحقق من حالة الدفع.
 * الحجز وعدٌ لا حركة مخزون؛ COD بلا حجز؛ المكنسة وحدها تحرّر بعد التحقق من المزوّد.
 */
class OnlineOrderStockHoldTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private Warehouse $warehouse;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        $this->warehouse = Warehouse::create(['name' => 'مخزن المتجر', 'code' => 'ONL-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        app(TenantContext::class)->forget();
    }

    private function tracked(int $onHand): Product
    {
        app(TenantContext::class)->set($this->tenant->id);
        $product = Product::create(['name' => 'منتج مخزني', 'sku' => 'TR-'.Str::random(8), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $this->channel->id, 'is_published' => true]);
        ProductWarehouseStock::create(['product_id' => $product->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => $onHand]);
        app(TenantContext::class)->forget();

        return $product;
    }

    /** @return \Illuminate\Support\Collection<int, InventoryReservation> */
    private function holds(string $orderId)
    {
        return InventoryReservation::query()->withoutGlobalScopes()->where('source_id', $orderId)->get();
    }

    private function expireHolds(string $orderId): void
    {
        DB::table('inventory_reservations')->where('source_id', $orderId)->update(['expires_at' => now('UTC')->subMinute()]);
    }

    private function sweep(): array
    {
        return app(CommerceUnpaidOrderSweeper::class)->run();
    }

    #[Test]
    public function an_online_order_holds_its_stock_for_sixty_minutes_without_moving_inventory(): void
    {
        $product = $this->tracked(10);
        $order = $this->onlineOrder(product: $product);

        $holds = $this->holds($order['order_id']);
        $this->assertCount(1, $holds);
        $this->assertSame('active', $holds[0]->status);
        $this->assertSame(1, (int) $holds[0]->base_quantity);
        $this->assertEqualsWithDelta(60, now('UTC')->diffInMinutes($holds[0]->expires_at, false), 1);
        $this->assertSame(0, DB::table('stock_movements')->count());
        $this->assertSame(10, (int) DB::table('product_warehouse_stock')->where('product_id', $product->id)->value('quantity'));
        $this->assertSame(0, DB::table('journal_entries')->count());
    }

    #[Test]
    public function the_hold_duration_is_a_validated_tenant_setting(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(60, CommercePaymentHold::minutes());
        \App\Support\Settings::put('sales', ['commerce_payment_hold_minutes' => 90]);
        $this->assertSame(90, CommercePaymentHold::minutes());
        \App\Support\Settings::put('sales', ['commerce_payment_hold_minutes' => 5]);
        $this->assertSame(15, CommercePaymentHold::minutes(), 'الأدنى 15');
        app(TenantContext::class)->forget();

        $token = $this->staffToken('owner');
        $this->withToken($token)->putJson('/api/sales-settings', ['commerce_payment_hold_minutes' => 5])->assertStatus(422);
        $this->withToken($token)->putJson('/api/sales-settings', ['commerce_payment_hold_minutes' => 45])->assertOk();
    }

    #[Test]
    public function a_second_buyer_cannot_take_stock_that_is_held_and_nothing_partial_is_left(): void
    {
        $product = $this->tracked(1);
        $first = $this->onlineOrder(product: $product, key: 'idem-h-001');

        $token = $this->readyCheckout($product, $this->method->id);
        $response = $this->complete($token, 'idem-h-002');
        $response->assertStatus(409);
        $this->assertSame('review_required', $response->json('error.code'));
        $this->assertSame('insufficient_stock', $response->json('error.details.items.0.reason'));
        $this->assertSame(1, CommerceOrder::query()->withoutGlobalScopes()->count());
        $this->assertCount(1, InventoryReservation::query()->withoutGlobalScopes()->get());
        $this->assertSame($first['order_id'], InventoryReservation::query()->withoutGlobalScopes()->first()->source_id);
    }

    #[Test]
    public function cod_orders_never_hold_stock(): void
    {
        $product = $this->tracked(5);
        $token = $this->readyCheckout($product, null);
        $this->complete($token, 'idem-h-cod')->assertCreated();

        $this->assertSame(0, InventoryReservation::query()->withoutGlobalScopes()->count());
    }

    #[Test]
    public function the_sweeper_leaves_live_holds_and_releases_an_unpaid_expired_one_after_verifying_the_provider(): void
    {
        $product = $this->tracked(3);
        $order = $this->onlineOrder(product: $product);
        $this->startPayment($order)->assertCreated();

        $this->assertSame(['processed' => 0, 'released' => 0, 'paid' => 0, 'skipped' => 0, 'failed' => 0], $this->sweep(), 'الحجز لم يحن موعده');

        $this->expireHolds($order['order_id']);
        $summary = $this->sweep();

        $this->assertSame(1, $summary['released']);
        $this->assertSame('released', $this->holds($order['order_id'])[0]->status);
        $this->assertSame('cancelled', $this->intent($order['order_id'])->status);
        $this->assertSame('cancelled', $this->attempts($order['order_id'])->first()->capture_status);
        $this->assertNotNull(CommerceOrder::query()->withoutGlobalScopes()->find($order['order_id']), 'الطلب يبقى سجلاً');
        $this->assertSame(0, DB::table('journal_entries')->count());

        $this->assertSame(0, $this->sweep()['processed'], 'idempotent');

        // المخزون عاد متاحاً لمشترٍ آخر.
        $token = $this->readyCheckout($product, $this->method->id);
        $this->complete($token, 'idem-h-next')->assertCreated();
    }

    #[Test]
    public function the_sweeper_never_releases_when_the_provider_cannot_be_verified(): void
    {
        $order = $this->onlineOrder(product: $this->tracked(3));
        $this->startPayment($order)->assertCreated();
        $this->expireHolds($order['order_id']);

        $this->fake->failFetchWith(new \RuntimeException('provider down'));
        $summary = $this->sweep();
        $this->fake->failFetchWith(null);

        $this->assertSame(0, $summary['released']);
        $this->assertSame('active', $this->holds($order['order_id'])[0]->status);
        $this->assertSame('pending', $this->intent($order['order_id'])->status);

        $this->assertSame(1, $this->sweep()['released'], 'بعد عودة المزوّد يكتمل التحرير');
    }

    #[Test]
    public function an_expired_hold_whose_payment_was_captured_becomes_permanent_not_released(): void
    {
        $order = $this->onlineOrder(product: $this->tracked(3));
        $this->startPayment($order)->assertCreated();
        $this->capture($this->attempts($order['order_id'])->first(), 5000);
        $this->expireHolds($order['order_id']);

        $summary = $this->sweep();

        $this->assertSame(1, $summary['paid']);
        $this->assertSame(0, $summary['released']);
        $hold = $this->holds($order['order_id'])[0];
        $this->assertSame('active', $hold->status);
        $this->assertNull($hold->expires_at, 'الحجز المدفوع دائم حتى الإصدار المحاسبي');
        $this->assertSame('paid', $this->intent($order['order_id'])->status);
        $this->assertSame(0, $this->sweep()['processed']);
    }

    #[Test]
    public function paying_before_expiry_makes_the_hold_permanent(): void
    {
        $order = $this->onlineOrder(product: $this->tracked(3));
        $this->startPayment($order)->assertCreated();
        $this->capture($this->attempts($order['order_id'])->first(), 5000);
        $this->paymentStatus($order)->assertOk();

        $this->assertSame('paid', $this->intent($order['order_id'])->status);
        $this->assertNull($this->holds($order['order_id'])[0]->expires_at);
    }

    #[Test]
    public function a_late_capture_after_the_sweeper_cancelled_goes_to_manual_review_and_does_not_revive_the_hold(): void
    {
        $order = $this->onlineOrder(product: $this->tracked(3));
        $this->startPayment($order)->assertCreated();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->expireHolds($order['order_id']);
        $this->sweep();

        $this->capture($attempt, 5000);
        app(TenantContext::class)->set($this->tenant->id);
        app(\App\Services\PaymentOrchestrator::class)->sync(PaymentAttempt::query()->findOrFail($attempt->id));
        app(CommerceOnlinePaymentService::class)->completeCaptured(PaymentAttempt::query()->findOrFail($attempt->id));

        $this->assertSame('cancelled', $this->intent($order['order_id'])->status);
        $this->assertContains(PaymentAttempt::REVIEW_LATE_CAPTURE, PaymentAttempt::query()->findOrFail($attempt->id)->review_reasons ?? []);
        $this->assertSame('released', $this->holds($order['order_id'])[0]->status);
    }

    #[Test]
    public function cancelling_an_unpaid_online_intent_releases_its_hold(): void
    {
        $order = $this->onlineOrder(product: $this->tracked(3));
        app(TenantContext::class)->set($this->tenant->id);
        app(\App\Services\Commerce\CommercePaymentIntentService::class)->cancel($this->intent($order['order_id']));

        $this->assertSame('released', $this->holds($order['order_id'])[0]->status);
    }

    #[Test]
    public function sweeper_runs_per_tenant_and_the_command_is_scheduled(): void
    {
        $order = $this->onlineOrder(product: $this->tracked(3));
        $this->expireHolds($order['order_id']);

        $this->artisan('commerce:expire-unpaid-orders')->assertSuccessful();

        $this->assertSame('released', $this->holds($order['order_id'])[0]->status);
        $scheduled = collect(app(\Illuminate\Console\Scheduling\Schedule::class)->events())->map(fn ($e) => $e->command)->implode("\n");
        $this->assertStringContainsString('commerce:expire-unpaid-orders', $scheduled);
    }

    #[Test]
    public function reservations_are_variant_aware_so_one_variant_never_consumes_its_siblings_stock(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $product = Product::create(['name' => 'منتج متغيّرات', 'sku' => 'VR-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
        $a = \App\Models\ProductVariant::create(['product_id' => $product->id, 'sku' => 'VA-'.Str::random(6), 'combination_key' => 'a-'.Str::random(5), 'is_active' => true]);
        $b = \App\Models\ProductVariant::create(['product_id' => $product->id, 'sku' => 'VB-'.Str::random(6), 'combination_key' => 'b-'.Str::random(5), 'is_active' => true]);
        ProductWarehouseStock::create(['product_id' => $product->id, 'product_variant_id' => $a->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => 1]);
        ProductWarehouseStock::create(['product_id' => $product->id, 'product_variant_id' => $b->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => 2]);
        $service = app(\App\Services\Commerce\InventoryReservationService::class);

        $service->acquire($product->id, $this->warehouse->id, 1, 'var-a-1', variantId: $a->id);
        $service->acquire($product->id, $this->warehouse->id, 2, 'var-b-1', variantId: $b->id);
        $this->assertSame(1, $service->activeReservedQuantity($product->id, $this->warehouse->id, $a->id));
        $this->assertSame(2, $service->activeReservedQuantity($product->id, $this->warehouse->id, $b->id));

        $this->expectException(\App\Services\Commerce\InsufficientAvailabilityException::class);
        $service->acquire($product->id, $this->warehouse->id, 1, 'var-a-2', variantId: $a->id);
    }

    private function staffToken(string $role): string
    {
        app(TenantContext::class)->set($this->tenant->id);
        $user = \App\Models\User::create(['tenant_id' => $this->tenant->id, 'name' => $role, 'email' => $role.'-'.Str::random(5).'@online-pay.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('t')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }
}
