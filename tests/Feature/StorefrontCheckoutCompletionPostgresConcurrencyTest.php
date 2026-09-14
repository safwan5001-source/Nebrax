<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceCartItem;
use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\CommerceCheckoutService;
use App\Support\PublicApiIdempotency;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * COM-CHECKOUT-1B — PostgreSQL row-lock regression: التزام
 * `CommerceCheckoutService::complete()` يقفل صفّ Checkout فعلياً؛ استدعاءٌ
 * متزامن يُحجب حتى تحرّره المعاملة الأولى، ولا يمكن أن ينشأ عن ذلك طلبان
 * لنفس Checkout. يكرّر نمط `StorefrontCheckoutPostgresConcurrencyTest`
 * (locker يحمل القفل يدوياً، ثم مستدعٍ حقيقي يُحجب فيُثبت القفل) بدل تشغيل
 * طلبين حقيقيين متزامنين فعلياً — نفس المبدأ المعتمد في هذا الملف الشقيق
 * وفي `CommerceOrderReservationPostgresConcurrencyTest`.
 */
class StorefrontCheckoutCompletionPostgresConcurrencyTest extends TestCase
{
    private ?Tenant $tenant = null;

    private ?SalesChannel $channel = null;

    private ?Storefront $storefront = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً لإثبات أقفال الصفوف.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->tenant = Tenant::create([
            'name' => 'Checkout completion concurrency',
            'slug' => 'checkout-complete-concurrency-'.Str::random(8),
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
            'is_active' => true,
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $this->storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $this->channel->id, 'is_active' => true,
        ]);
        $this->establishContext();
    }

    protected function tearDown(): void
    {
        if ($this->tenant !== null) {
            $tenantId = $this->tenant->id;
            DB::table('commerce_orders')->where('tenant_id', $tenantId)->delete();
            DB::table('commerce_order_lines')->where('tenant_id', $tenantId)->delete();
            DB::table('commerce_order_snapshots')->where('tenant_id', $tenantId)->delete();
            DB::table('commerce_checkouts')->where('tenant_id', $tenantId)->delete();
            DB::table('commerce_cart_items')->where('tenant_id', $tenantId)->delete();
            DB::table('commerce_carts')->where('tenant_id', $tenantId)->delete();
            DB::table('commerce_listings')->where('tenant_id', $tenantId)->delete();
            DB::table('storefronts')->where('tenant_id', $tenantId)->delete();
            DB::table('sales_channels')->where('tenant_id', $tenantId)->delete();
            DB::table('products')->where('tenant_id', $tenantId)->delete();
            DB::table('tenants')->where('id', $tenantId)->delete();
        }

        parent::tearDown();
    }

    /** @test */
    public function a_blocked_concurrent_completion_still_resolves_to_exactly_one_order(): void
    {
        $product = Product::create([
            'name' => 'Checkout completion race product', 'sku' => 'CHKCRACE-'.Str::random(8),
            'unit' => 'piece', 'sale_price' => 3300, 'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $this->channel->id, 'is_published' => true,
        ]);
        $cart = CommerceCart::create([
            'storefront_id' => $this->storefront->id,
            'sales_channel_id' => $this->channel->id,
            'token_hash' => hash('sha256', 'checkout-complete-race-token-'.Str::random(16)),
            'expires_at' => now()->addDay(),
        ]);
        CommerceCartItem::create([
            'cart_id' => $cart->id, 'product_id' => $product->id, 'product_name_snapshot' => $product->name,
            'unit_key' => 'base', 'unit_name_snapshot' => 'piece', 'quantity' => 1,
        ]);
        $checkout = CommerceCheckout::create([
            'storefront_id' => $this->storefront->id,
            'sales_channel_id' => $this->channel->id,
            'cart_id' => $cart->id,
            'expires_at' => now()->addHour(),
            'contact_name' => 'راكز السباق', 'contact_phone' => '0500000000',
            'delivery_country' => 'SA', 'delivery_city' => 'الدمام', 'delivery_street' => 'شارع',
            'delivery_method' => 'pickup',
        ]);

        $rawKey = 'checkout-complete-race-key-'.Str::random(16);
        $keyHash = PublicApiIdempotency::hashKey($rawKey);
        $fingerprint = hash('sha256', 'fixed-fingerprint-for-race-test');

        $lockReady = $this->signalPath('checkout_complete_lock_');
        $completeStarted = $this->signalPath('checkout_complete_started_');
        $resultFile = tempnam(sys_get_temp_dir(), 'checkout_complete_race_result_');

        // First process: holds the checkout row lock (the same row
        // CommerceCheckoutService::complete() locks) so the second process's
        // real complete() call must wait for it.
        $locker = pcntl_fork();
        if ($locker === 0) {
            DB::purge(config('database.default'));
            DB::transaction(function () use ($checkout, $lockReady, $completeStarted): void {
                DB::table('commerce_checkouts')->where('id', $checkout->id)->lockForUpdate()->first();
                touch($lockReady);
                $this->waitForSignal($completeStarted);
                usleep(500000);
            });
            exit(0);
        }
        $this->assertGreaterThan(0, $locker);
        $this->waitForSignal($lockReady);

        $completer = pcntl_fork();
        if ($completer === 0) {
            DB::purge(config('database.default'));
            $this->establishContext();
            touch($completeStarted);
            try {
                $result = app(CommerceCheckoutService::class)->complete($checkout, $keyHash, $fingerprint);
                file_put_contents($resultFile, json_encode([
                    'ok' => true,
                    'order_id' => $result['order']->id,
                    'replayed' => $result['replayed'],
                ]));
            } catch (\Throwable $exception) {
                file_put_contents($resultFile, json_encode([
                    'ok' => false,
                    'message' => $exception->getMessage(),
                ]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $completer);

        pcntl_waitpid($locker, $status);
        pcntl_waitpid($completer, $status);
        $result = json_decode((string) file_get_contents($resultFile), true);
        $this->cleanupSignals([$lockReady, $completeStarted, $resultFile]);

        $this->assertTrue($result['ok'], json_encode($result));
        $this->assertFalse($result['replayed']); // no order existed yet — this call is the one that creates it
        $this->assertSame(1, DB::table('commerce_orders')->where('commerce_checkout_id', $checkout->id)->count());

        // A second call with the SAME key must replay, never create a second order.
        $second = app(CommerceCheckoutService::class)->complete($checkout, $keyHash, $fingerprint);
        $this->assertTrue($second['replayed']);
        $this->assertSame($result['order_id'], $second['order']->id);
        $this->assertSame(1, DB::table('commerce_orders')->where('commerce_checkout_id', $checkout->id)->count());
        $this->assertSame(
            CommerceCheckout::STATUS_COMPLETED,
            DB::table('commerce_checkouts')->where('id', $checkout->id)->value('status'),
        );
        $this->assertSame(
            CommerceOrder::STATUS_CONFIRMED,
            DB::table('commerce_orders')->where('commerce_checkout_id', $checkout->id)->value('status'),
        );
    }

    private function establishContext(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        app(StorefrontContext::class)->set($this->tenant->id, $this->channel->id, $this->storefront->id);
    }

    private function signalPath(string $prefix): string
    {
        $path = tempnam(sys_get_temp_dir(), $prefix);
        unlink($path);

        return $path;
    }

    private function waitForSignal(string $path): void
    {
        $deadline = microtime(true) + 5.0;
        while (! file_exists($path) && microtime(true) < $deadline) {
            usleep(1000);
        }
        if (! file_exists($path)) {
            throw new \RuntimeException("Timed out waiting for {$path}");
        }
    }

    /** @param list<string> $paths */
    private function cleanupSignals(array $paths): void
    {
        foreach ($paths as $path) {
            @unlink($path);
        }
    }
}
