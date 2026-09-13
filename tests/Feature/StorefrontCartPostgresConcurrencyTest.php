<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\CommerceCartService;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** PostgreSQL row-lock regressions for COM-CART-2. */
class StorefrontCartPostgresConcurrencyTest extends TestCase
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
            'name' => 'Cart concurrency',
            'slug' => 'cart-concurrency-'.Str::random(8),
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
            'is_active' => true,
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->channel = SalesChannel::create([
            'slug' => 'web',
            'name' => 'Web',
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ]);
        $this->storefront = Storefront::create([
            'slug' => 'main',
            'name' => 'Main',
            'sales_channel_id' => $this->channel->id,
            'is_active' => true,
        ]);
        $this->establishContext();
    }

    protected function tearDown(): void
    {
        if ($this->tenant !== null) {
            $tenantId = $this->tenant->id;
            DB::table('commerce_cart_items')->where('tenant_id', $tenantId)->delete();
            DB::table('commerce_carts')->where('tenant_id', $tenantId)->delete();
            DB::table('commerce_listings')->where('tenant_id', $tenantId)->delete();
            DB::table('storefront_domains')->where('tenant_id', $tenantId)->delete();
            DB::table('storefronts')->where('tenant_id', $tenantId)->delete();
            DB::table('sales_channels')->where('tenant_id', $tenantId)->delete();
            DB::table('products')->where('tenant_id', $tenantId)->delete();
            DB::table('tenants')->where('id', $tenantId)->delete();
        }

        parent::tearDown();
    }

    /** @test */
    public function add_revalidates_after_waiting_for_the_cart_lock(): void
    {
        $product = Product::create([
            'name' => 'Race product',
            'sku' => 'RACE-'.Str::random(8),
            'unit' => 'piece',
            'sale_price' => 1250,
            'is_active' => true,
        ]);
        $listing = CommerceListing::create([
            'product_id' => $product->id,
            'sales_channel_id' => $this->channel->id,
            'is_published' => true,
        ]);
        $cart = $this->cart(now()->addDay());
        $lockReady = $this->signalPath('cart_lock_');
        $addStarted = $this->signalPath('cart_add_');
        $resultFile = tempnam(sys_get_temp_dir(), 'cart_result_');

        $locker = pcntl_fork();
        if ($locker === 0) {
            DB::purge(config('database.default'));
            DB::transaction(function () use ($cart, $listing, $lockReady, $addStarted): void {
                DB::table('commerce_carts')->where('id', $cart->id)->lockForUpdate()->first();
                touch($lockReady);
                $this->waitForSignal($addStarted);
                usleep(500000);
                DB::table('commerce_listings')->where('id', $listing->id)->update(['is_published' => false]);
            });
            exit(0);
        }
        $this->assertGreaterThan(0, $locker);
        $this->waitForSignal($lockReady);

        $adder = pcntl_fork();
        if ($adder === 0) {
            DB::purge(config('database.default'));
            $this->establishContext();
            touch($addStarted);
            try {
                app(CommerceCartService::class)->add(
                    CommerceCart::query()->findOrFail($cart->id),
                    $product->id,
                    'base',
                    1,
                );
                file_put_contents($resultFile, json_encode(['ok' => true]));
            } catch (\Throwable $exception) {
                file_put_contents($resultFile, json_encode([
                    'ok' => false,
                    'message' => $exception->getMessage(),
                ]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $adder);

        pcntl_waitpid($locker, $status);
        pcntl_waitpid($adder, $status);
        $result = json_decode((string) file_get_contents($resultFile), true);
        $this->cleanupSignals([$lockReady, $addStarted, $resultFile]);

        $this->assertFalse($result['ok'], json_encode($result));
        $this->assertSame('المنتج غير متاح للشراء.', $result['message']);
        $this->assertSame(0, DB::table('commerce_cart_items')->where('cart_id', $cart->id)->count());
    }

    /** @test */
    public function expiry_read_does_not_overwrite_a_concurrent_renewal(): void
    {
        $token = 'expiry-race-token';
        $cart = $this->cart(now()->subSecond(), hash('sha256', $token));
        $renewalReady = $this->signalPath('cart_renewal_');
        $resultFile = tempnam(sys_get_temp_dir(), 'cart_expiry_result_');

        $renewer = pcntl_fork();
        if ($renewer === 0) {
            DB::purge(config('database.default'));
            DB::transaction(function () use ($cart, $renewalReady): void {
                DB::table('commerce_carts')->where('id', $cart->id)->lockForUpdate()->first();
                DB::table('commerce_carts')->where('id', $cart->id)->update([
                    'expires_at' => now()->addDays(CommerceCartService::LIFETIME_DAYS),
                ]);
                touch($renewalReady);
                usleep(500000);
            });
            exit(0);
        }
        $this->assertGreaterThan(0, $renewer);
        $this->waitForSignal($renewalReady);

        $reader = pcntl_fork();
        if ($reader === 0) {
            DB::purge(config('database.default'));
            $this->establishContext();
            $result = app(CommerceCartService::class)->findByToken($token);
            file_put_contents($resultFile, json_encode([
                'invalid' => $result['invalid'],
                'cart_id' => $result['cart']?->id,
            ]));
            exit(0);
        }
        $this->assertGreaterThan(0, $reader);

        pcntl_waitpid($renewer, $status);
        pcntl_waitpid($reader, $status);
        $result = json_decode((string) file_get_contents($resultFile), true);
        $this->cleanupSignals([$renewalReady, $resultFile]);

        $this->assertFalse($result['invalid']);
        $this->assertSame($cart->id, $result['cart_id']);
        $fresh = DB::table('commerce_carts')->where('id', $cart->id)->first();
        $this->assertSame(CommerceCart::STATUS_ACTIVE, $fresh->status);
        $this->assertTrue(now()->isBefore($fresh->expires_at));
    }

    private function cart($expiresAt, ?string $tokenHash = null): CommerceCart
    {
        return CommerceCart::create([
            'storefront_id' => $this->storefront->id,
            'sales_channel_id' => $this->channel->id,
            'token_hash' => $tokenHash ?? hash('sha256', Str::random(43)),
            'expires_at' => $expiresAt,
        ]);
    }

    private function establishContext(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        app(StorefrontContext::class)->set(
            $this->tenant->id,
            $this->channel->id,
            $this->storefront->id,
        );
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
