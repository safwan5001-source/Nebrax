<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CustomerIdentity;
use App\Models\Partner;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\WholesaleMembershipService;
use App\Services\CustomerPartnerLinkService;
use App\Services\PriceListService;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch J — تزامن حقيقي (PostgreSQL): تغيير قائمة السعر أثناء حلّ سعر الإتمام
 * ═══════════════════════════════════════════════════════════════
 *  إتمام الجملة يحلّ السعر بـ`lockEligibility=true`: يقفل صف القائمة ويعيد قراءته. النتيجة المطلوبة:
 *   (أ) تعطيل قائمة بينما حلّ سعرٍ جارٍ ينتظر التزام ذلك الحلّ (لا يتغيّر السعر تحت قدمَي معاملة الإتمام)؛
 *   (ب) تعطيلٌ سبق الإتمام والتزم ⇒ الإتمام يرى القائمة معطّلة فيسقط إلى قائمة القناة، لا إلى سعر قديم ولا إلى التجزئة.
 *  يفشل (لا يتخطّى) على PostgreSQL إن غاب pcntl؛ يُتخطّى على SQLite فقط.
 */
class WholesalePricePrecedencePostgresConcurrencyTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $channelId;

    private string $productId;

    private string $identityId;

    private string $partnerListId;

    private string $channelListId;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');
        config(['commerce.wholesale_buyer_enabled' => true]);

        $this->dir = sys_get_temp_dir().'/wholesale_price_pg_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'تسعير جملة متزامن', 'slug' => 'wp-pg-'.Str::random(8), 'vat_number' => '300000000000023', 'currency' => 'SAR']);
        $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);

        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        $this->channelId = $channel->id;
        $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => 'wp-pg-'.Str::random(5).'.test', 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        $product = Product::create(['name' => 'صنف', 'sku' => 'WP-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 1000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        $this->productId = $product->id;

        $channelList = PriceList::create(['name' => 'ch-'.Str::random(4), 'is_active' => true]);
        app(PriceListService::class)->upsertItem($channelList, $product, ['price' => 700]);
        $channel->update(['default_price_list_id' => $channelList->id]);
        $this->channelListId = $channelList->id;

        $partnerList = PriceList::create(['name' => 'pt-'.Str::random(4), 'is_active' => true]);
        app(PriceListService::class)->upsertItem($partnerList, $product, ['price' => 500]);
        $this->partnerListId = $partnerList->id;
        $partner = Partner::create(['name' => 'عميل', 'type' => 'customer', 'default_price_list_id' => $partnerList->id]);

        $owner = User::create(['tenant_id' => $this->tenantId, 'name' => 'owner', 'email' => 'o-'.Str::random(6).'@pg.test', 'password' => 'password123', 'role' => 'owner']);
        $identity = CustomerIdentity::create([
            'tenant_id' => $this->tenantId, 'display_name' => 'B', 'email' => 'b-'.Str::random(5).'@pg.test', 'password' => 'correct-horse-9',
            'email_verified_at' => now(), 'is_active' => true,
        ]);
        $membership = app(WholesaleMembershipService::class)->apply($identity, $channel->id);
        app(WholesaleMembershipService::class)->transition($membership->id, 'approve', $owner);
        app(CustomerPartnerLinkService::class)->link($identity, $partner, $owner);
        $this->identityId = $identity->id;
        app(TenantContext::class)->forget();
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (isset($this->tenantId) && DB::connection()->getDriverName() === 'pgsql') {
            DB::table('sales_channels')->where('tenant_id', $this->tenantId)->update(['default_price_list_id' => null]);
            DB::table('price_list_items')->where('tenant_id', $this->tenantId)->delete();
            DB::table('customer_partner_links')->where('tenant_id', $this->tenantId)->delete();
            DB::table('wholesale_membership_events')->where('tenant_id', $this->tenantId)->delete();
            DB::table('wholesale_memberships')->where('tenant_id', $this->tenantId)->delete();
            DB::table('tenants')->where('id', $this->tenantId)->delete();
        }

        parent::tearDown();
    }

    #[Test]
    public function deactivating_a_list_waits_for_an_in_flight_checkout_price_resolution(): void
    {
        [$tenant, $identity, $channel, $product, $partnerList] = [$this->tenantId, $this->identityId, $this->channelId, $this->productId, $this->partnerListId];

        // checkout side: resolves with lockEligibility=true inside a transaction that stays open 500 ms
        $checkout = function () use ($tenant, $identity, $channel, $product): array {
            app(TenantContext::class)->set($tenant);
            app(CustomerContext::class)->set($tenant, $identity, null);
            $amount = null;
            DB::transaction(function () use ($channel, $product, &$amount): void {
                $amount = app(CommercePriceResolver::class)->resolve($product, $channel, null, null, true)->amount;
                usleep(500000);
            });

            return ['amount' => $amount];
        };
        // admin side: deactivates the partner list ~150 ms later (after checkout holds the row lock)
        $admin = function () use ($tenant, $partnerList): array {
            usleep(150000);
            $start = microtime(true);
            DB::table('price_lists')->where('id', $partnerList)->where('tenant_id', $tenant)->update(['is_active' => false]);

            return ['waited_ms' => (int) round((microtime(true) - $start) * 1000)];
        };

        $results = $this->runConcurrently([$checkout, $admin]);
        $this->assertAllOk($results);

        $this->assertSame(500, $results[0]['value']['amount'], 'the in-flight checkout keeps the partner price it resolved under lock');
        $this->assertGreaterThanOrEqual(200, $results[1]['value']['waited_ms'], 'the deactivation had to wait for that checkout: '.json_encode($results));
        $this->assertFalse((bool) DB::table('price_lists')->where('id', $partnerList)->value('is_active'));
    }

    #[Test]
    public function a_deactivation_committed_just_before_the_locked_resolution_is_seen_and_falls_to_the_channel_list_never_retail(): void
    {
        [$tenant, $identity, $channel, $product, $partnerList] = [$this->tenantId, $this->identityId, $this->channelId, $this->productId, $this->partnerListId];

        // admin side: deactivates the partner list inside a transaction that commits after 400 ms
        $admin = function () use ($tenant, $partnerList): array {
            DB::transaction(function () use ($tenant, $partnerList): void {
                DB::table('price_lists')->where('id', $partnerList)->where('tenant_id', $tenant)->update(['is_active' => false]);
                usleep(400000);
            });

            return ['done' => true];
        };
        // checkout side: builds its context while the list still looks active, then must re-read it under lock
        $checkout = function () use ($tenant, $identity, $channel, $product): array {
            usleep(100000);
            app(TenantContext::class)->set($tenant);
            app(CustomerContext::class)->set($tenant, $identity, null);
            $start = microtime(true);
            $price = null;
            DB::transaction(function () use ($channel, $product, &$price): void {
                $price = app(CommercePriceResolver::class)->resolve($product, $channel, null, null, true);
            });

            return ['amount' => $price->amount, 'list' => $price->priceListId, 'source' => $price->source, 'waited_ms' => (int) round((microtime(true) - $start) * 1000)];
        };

        $results = $this->runConcurrently([$admin, $checkout]);
        $this->assertAllOk($results);

        $this->assertSame(700, $results[1]['value']['amount'], 'the locked re-read sees the deactivation ⇒ channel list (700), not the stale 500 and not the retail 1000: '.json_encode($results));
        $this->assertSame($this->channelListId, $results[1]['value']['list']);
        $this->assertSame('price_list', $results[1]['value']['source']);
        $this->assertGreaterThanOrEqual(150, $results[1]['value']['waited_ms'], 'the resolution waited for the in-flight deactivation');
    }

    // ───────────────────────── حاضنة الأطفال ─────────────────────────

    /** @param array<int, array<string, mixed>> $results */
    private function assertAllOk(array $results): void
    {
        foreach ($results as $i => $r) {
            $this->assertTrue($r['ok'] ?? false, "العملية {$i} فشلت: ".json_encode($r));
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier_'.uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir.'/result_'.uniqid()."_{$i}";
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    $value = $job();
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $value]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode([
                        'ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage(),
                    ]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
