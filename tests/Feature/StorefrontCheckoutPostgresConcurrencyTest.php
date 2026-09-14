<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\CommerceCheckoutService;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * COM-CHECKOUT-1A — PostgreSQL row-lock regression: two concurrent
 * POST /store/v1/checkout requests for the same cart must resume the same
 * open Checkout, never create two. Mirrors
 * StorefrontCartPostgresConcurrencyTest's own lock-holder pattern.
 */
class StorefrontCheckoutPostgresConcurrencyTest extends TestCase
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
            'name' => 'Checkout concurrency',
            'slug' => 'checkout-concurrency-'.Str::random(8),
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
    public function two_concurrent_checkout_creations_for_the_same_cart_resolve_to_one_open_checkout(): void
    {
        $product = Product::create([
            'name' => 'Checkout race product', 'sku' => 'CHKRACE-'.Str::random(8),
            'unit' => 'piece', 'sale_price' => 1250, 'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $this->channel->id, 'is_published' => true,
        ]);
        $rawToken = 'checkout-race-token-'.Str::random(16);
        $cart = CommerceCart::create([
            'storefront_id' => $this->storefront->id,
            'sales_channel_id' => $this->channel->id,
            'token_hash' => hash('sha256', $rawToken),
            'expires_at' => now()->addDay(),
        ]);

        $lockReady = $this->signalPath('checkout_lock_');
        $resumeStarted = $this->signalPath('checkout_resume_');
        $resultFile = tempnam(sys_get_temp_dir(), 'checkout_race_result_');

        // First process: holds the cart row lock (the same row
        // CommerceCheckoutService::lockActiveCart() locks) so the second
        // process's createOrResume() call must wait for it.
        $locker = pcntl_fork();
        if ($locker === 0) {
            DB::purge(config('database.default'));
            DB::transaction(function () use ($cart, $lockReady, $resumeStarted): void {
                DB::table('commerce_carts')->where('id', $cart->id)->lockForUpdate()->first();
                touch($lockReady);
                $this->waitForSignal($resumeStarted);
                usleep(500000);
            });
            exit(0);
        }
        $this->assertGreaterThan(0, $locker);
        $this->waitForSignal($lockReady);

        $resumer = pcntl_fork();
        if ($resumer === 0) {
            DB::purge(config('database.default'));
            $this->establishContext();
            touch($resumeStarted);
            try {
                $result = app(CommerceCheckoutService::class)->createOrResume($rawToken);
                file_put_contents($resultFile, json_encode([
                    'ok' => true,
                    'checkout_id' => $result['checkout']->id,
                    'created' => $result['created'],
                ]));
            } catch (\Throwable $exception) {
                file_put_contents($resultFile, json_encode([
                    'ok' => false,
                    'message' => $exception->getMessage(),
                ]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $resumer);

        pcntl_waitpid($locker, $status);
        pcntl_waitpid($resumer, $status);
        $result = json_decode((string) file_get_contents($resultFile), true);
        $this->cleanupSignals([$lockReady, $resumeStarted, $resultFile]);

        $this->assertTrue($result['ok'], json_encode($result));
        $this->assertTrue($result['created']); // no checkout existed yet — this call is the one that creates it
        $this->assertSame(1, DB::table('commerce_checkouts')->where('cart_id', $cart->id)->count());

        // Now a third call for the same cart must resume, never create a second row.
        $second = app(CommerceCheckoutService::class)->createOrResume($rawToken);
        $this->assertFalse($second['created']);
        $this->assertSame($result['checkout_id'], $second['checkout']->id);
        $this->assertSame(1, DB::table('commerce_checkouts')->where('cart_id', $cart->id)->count());
        $this->assertSame(
            CommerceCheckout::STATUS_ACTIVE,
            DB::table('commerce_checkouts')->where('cart_id', $cart->id)->value('status'),
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
