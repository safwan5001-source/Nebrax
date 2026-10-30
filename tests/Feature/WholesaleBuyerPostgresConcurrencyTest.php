<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CustomerEmailVerificationToken;
use App\Models\CustomerIdentity;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WholesaleMembership;
use App\Services\Commerce\BuyerEmailVerificationService;
use App\Services\Commerce\CommerceOrderService;
use App\Services\Commerce\WholesaleMembershipService;
use App\Tenancy\CustomerContext;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch H — تزامن حقيقي متعدد العمليات (PostgreSQL) لمسارين حساسين
 * ═══════════════════════════════════════════════════════════════
 *  (1) استهلاك رابط التأكيد نفسه من عدة عمليات في آنٍ واحد ⇒ ينجح واحد فقط (قفل صف الرمز).
 *  (2) إنشاء طلب جملة مقابل إيقاف العضوية: القفل المشترك داخل معاملة الطلب يُسلسل الحدثين — إمّا يُرفض الطلب لأن الإيقاف سبق،
 *      وإمّا يُلتزم الطلب والإيقاف ينتظر التزامه. لا طلب لمشترٍ موقوف بعد الإيقاف.
 *  يفشل (لا يتخطّى) على PostgreSQL إن غاب pcntl؛ يُتخطّى على SQLite فقط.
 */
class WholesaleBuyerPostgresConcurrencyTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $channelId;

    private string $storefrontId;

    private string $productId;

    private string $actorId;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');
        config(['commerce.wholesale_buyer_enabled' => true]);

        $this->dir = sys_get_temp_dir().'/wholesale_buyer_pg_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'جملة متزامنة 2', 'slug' => 'wb-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        $this->channelId = $channel->id;
        $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        $this->storefrontId = $storefront->id;
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => 'wb-pg-'.Str::random(5).'.test', 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $product = Product::create(['name' => 'صنف', 'sku' => 'WB-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 700, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        $this->productId = $product->id;
        $this->actorId = User::create([
            'tenant_id' => $this->tenantId, 'name' => 'owner', 'email' => 'o-'.Str::random(6).'@pg.test', 'password' => 'password123', 'role' => 'owner',
        ])->id;
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                DB::table('commerce_order_lines')->where('tenant_id', $id)->delete();
                DB::table('commerce_order_snapshots')->where('tenant_id', $id)->delete();
                DB::table('commerce_orders')->where('tenant_id', $id)->delete();
                DB::table('customer_email_verification_tokens')->where('tenant_id', $id)->delete();
                DB::table('wholesale_membership_events')->where('tenant_id', $id)->delete();
                DB::table('wholesale_memberships')->where('tenant_id', $id)->delete();
                DB::table('tenants')->where('id', $id)->delete();
            }
        }

        parent::tearDown();
    }

    private function identity(string $label, bool $verified = true): CustomerIdentity
    {
        app(TenantContext::class)->set($this->tenantId);

        return CustomerIdentity::create([
            'tenant_id' => $this->tenantId, 'display_name' => $label, 'email' => $label.'-'.Str::random(5).'@pg.test',
            'password' => 'correct-horse-9', 'email_verified_at' => $verified ? now() : null, 'is_active' => true,
        ]);
    }

    private function approvedMembership(CustomerIdentity $identity): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $service = app(WholesaleMembershipService::class);
        $membership = $service->apply($identity, $this->channelId);
        $service->transition($membership->id, 'approve', User::query()->findOrFail($this->actorId));

        return $membership->id;
    }

    // ───────────────────────── 1 · رابط التأكيد ─────────────────────────

    #[Test]
    public function four_processes_presenting_the_same_link_verify_exactly_once(): void
    {
        $identity = $this->identity('verify', verified: false);
        $plain = Str::random(64);
        app(TenantContext::class)->set($this->tenantId);
        CustomerEmailVerificationToken::query()->create([
            'tenant_id' => $this->tenantId, 'customer_identity_id' => $identity->id, 'sales_channel_id' => $this->channelId,
            'token_hash' => hash('sha256', $plain), 'expires_at' => now()->addHour(),
        ]);
        [$tenant, $channel, $storefront] = [$this->tenantId, $this->channelId, $this->storefrontId];

        $job = function () use ($tenant, $channel, $storefront, $plain): array {
            app(TenantContext::class)->set($tenant);
            app(StorefrontContext::class)->set($tenant, $channel, $storefront);

            return ['verified' => app(BuyerEmailVerificationService::class)->verify($plain)];
        };

        $results = $this->runConcurrently([$job, $job, $job, $job]);
        $this->assertAllOk($results);

        $this->assertCount(1, array_filter($results, fn ($r) => $r['value']['verified']), json_encode($results));
        $this->assertNotNull(DB::table('customer_identities')->where('id', $identity->id)->value('email_verified_at'));
        $this->assertSame(1, DB::table('customer_email_verification_tokens')->whereNotNull('used_at')->count());
    }

    // ───────────────────────── 2 · الطلب مقابل الإيقاف ─────────────────────────

    /** @return array{0: array<string,mixed>, 1: array<int,array<string,mixed>>} */
    private function orderPayload(): array
    {
        return [
            ['sales_channel_id' => $this->channelId, 'storefront_id' => $this->storefrontId, 'commerce_checkout_id' => null, 'delivery_method' => 'pickup', 'delivery_amount_minor' => 0,
                'contact_name' => 'مشتري', 'contact_phone' => null, 'contact_email' => null,
                'delivery_country' => null, 'delivery_region' => null, 'delivery_city' => null, 'delivery_district' => null,
                'delivery_street' => null, 'delivery_building_no' => null, 'delivery_additional_number' => null,
                'delivery_postal_code' => null, 'delivery_notes' => null],
            [['product_id' => $this->productId, 'product_name_snapshot' => 'صنف', 'quantity' => 1, 'unit_name' => null, 'unit_factor' => 1, 'unit_price' => 700, 'line_total' => 700]],
        ];
    }

    #[Test]
    public function a_suspension_that_commits_first_makes_the_concurrent_order_fail_and_leaves_no_order(): void
    {
        $identity = $this->identity('susp-first');
        $membershipId = $this->approvedMembership($identity);
        [$tenant, $actor, $identityId] = [$this->tenantId, $this->actorId, $identity->id];
        [$header, $lines] = $this->orderPayload();

        // holder: takes the membership row lock as a suspension would, holds it, suspends, commits
        $suspender = function () use ($tenant, $membershipId, $actor): array {
            app(TenantContext::class)->set($tenant);
            app(WholesaleMembershipService::class)->transition($membershipId, 'suspend', User::query()->findOrFail($actor));

            return ['suspended' => true];
        };
        // order: starts right after, must observe the suspension (or wait for it) and be refused
        $orderer = function () use ($tenant, $identityId, $header, $lines): array {
            app(TenantContext::class)->set($tenant);
            app(CustomerContext::class)->set($tenant, $identityId, null);
            usleep(150000);
            try {
                app(CommerceOrderService::class)->createFromCheckout($header, $lines);

                return ['order' => true];
            } catch (\RuntimeException $e) {
                return ['order' => false, 'message' => $e->getMessage()];
            }
        };

        $results = $this->runConcurrently([$suspender, $orderer]);
        $this->assertAllOk($results);

        $status = DB::table('wholesale_memberships')->where('id', $membershipId)->value('status');
        $this->assertSame('suspended', $status);
        // the invariant: an order may exist only if it was committed while the buyer was still approved — and the
        // suspension's own timestamp then post-dates the order. A suspended buyer never ends up with a later order.
        $orders = DB::table('commerce_orders')->where('customer_identity_id', $identityId)->get();
        $decidedAt = DB::table('wholesale_memberships')->where('id', $membershipId)->value('decided_at');
        foreach ($orders as $order) {
            $this->assertLessThanOrEqual(strtotime((string) $decidedAt), strtotime((string) $order->created_at), 'no order after the suspension');
        }
        if ($orders->isEmpty()) {
            $this->assertFalse($results[1]['value']['order']);
        }
    }

    #[Test]
    public function an_order_in_flight_makes_a_concurrent_suspension_wait_for_its_commit(): void
    {
        $identity = $this->identity('order-first');
        $membershipId = $this->approvedMembership($identity);
        [$tenant, $actor, $identityId] = [$this->tenantId, $this->actorId, $identity->id];
        [$header, $lines] = $this->orderPayload();

        // the order's transaction stays open 500 ms after it has read (and shared-locked) the approved membership
        $orderer = function () use ($tenant, $identityId, $header, $lines): array {
            app(TenantContext::class)->set($tenant);
            app(CustomerContext::class)->set($tenant, $identityId, null);
            DB::transaction(function () use ($header, $lines): void {
                app(CommerceOrderService::class)->createFromCheckout($header, $lines);
                usleep(500000);
            });

            return ['order' => true];
        };
        $suspender = function () use ($tenant, $membershipId, $actor): array {
            app(TenantContext::class)->set($tenant);
            usleep(150000); // the order has taken its lock by now
            $start = microtime(true);
            app(WholesaleMembershipService::class)->transition($membershipId, 'suspend', User::query()->findOrFail($actor));

            return ['waited_ms' => (int) round((microtime(true) - $start) * 1000)];
        };

        $results = $this->runConcurrently([$orderer, $suspender]);
        $this->assertAllOk($results);

        $this->assertGreaterThanOrEqual(200, $results[1]['value']['waited_ms'], 'the suspension must wait for the in-flight order: '.json_encode($results));
        $this->assertSame(1, CommerceOrder::withoutGlobalScopes()->where('customer_identity_id', $identityId)->count());
        $this->assertSame('suspended', WholesaleMembership::withoutGlobalScopes()->findOrFail($membershipId)->status);
    }

    #[Test]
    public function the_approval_check_holds_a_lock_that_a_concurrent_suspension_must_wait_for(): void
    {
        // The order service also serializes on the numbering anchor (a tenant row lock), which would mask a missing
        // membership lock in the end-to-end test above. This isolates the approval check itself: the window between
        // "read approved" and "commit" must exclude a suspension.
        $identity = $this->identity('lock-only');
        $membershipId = $this->approvedMembership($identity);
        [$tenant, $actor, $identityId, $channelId] = [$this->tenantId, $this->actorId, $identity->id, $this->channelId];

        $checker = function () use ($tenant, $identityId, $channelId): array {
            app(TenantContext::class)->set($tenant);
            DB::transaction(function () use ($identityId, $channelId): void {
                $service = app(CommerceOrderService::class);
                $method = new \ReflectionMethod($service, 'assertWholesaleBuyerStillApproved');
                $method->invoke($service, $channelId, $identityId);
                usleep(500000);
            });

            return ['checked' => true];
        };
        $suspender = function () use ($tenant, $membershipId, $actor): array {
            app(TenantContext::class)->set($tenant);
            usleep(150000); // the check has read (and locked) the row by now
            $start = microtime(true);
            app(WholesaleMembershipService::class)->transition($membershipId, 'suspend', User::query()->findOrFail($actor));

            return ['waited_ms' => (int) round((microtime(true) - $start) * 1000)];
        };

        $results = $this->runConcurrently([$checker, $suspender]);
        $this->assertAllOk($results);

        $this->assertGreaterThanOrEqual(200, $results[1]['value']['waited_ms'], 'the suspension must wait for the in-flight approval check: '.json_encode($results));
        $this->assertSame('suspended', WholesaleMembership::withoutGlobalScopes()->findOrFail($membershipId)->status);
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
