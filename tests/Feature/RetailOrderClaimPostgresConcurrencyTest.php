<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CustomerIdentity;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\CommerceOrderOwnershipClaimService;
use App\Services\Commerce\CommerceOrderService;
use App\Support\CommerceOrderReference;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  B2C-ACCOUNTS — تزامن حقيقي متعدد العمليات (PostgreSQL) لربط طلب الضيف بحساب
 * ═══════════════════════════════════════════════════════════════
 *  عدة عمليات (حسابان مختلفان، كلٌّ بدليل ملكية صالح) تحاول ربط الطلب نفسه في آنٍ واحد ⇒ يربحه واحد فقط، صفّ تدقيق واحد،
 *  والمالك لا يتغيّر بعد ذلك. يفشل (لا يتخطّى) على PostgreSQL إن غاب pcntl؛ يُتخطّى على SQLite فقط.
 */
class RetailOrderClaimPostgresConcurrencyTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $channelId;

    private string $storefrontId;

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

        $this->dir = sys_get_temp_dir().'/retail_claim_pg_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'تجزئة متزامنة', 'slug' => 'rc-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $this->channelId = $channel->id;
        $this->storefrontId = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $channel->id, 'is_active' => true])->id;
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
                DB::table('commerce_order_ownership_claims')->where('tenant_id', $id)->delete();
                DB::table('commerce_order_lines')->where('tenant_id', $id)->delete();
                DB::table('commerce_order_snapshots')->where('tenant_id', $id)->delete();
                DB::table('commerce_orders')->where('tenant_id', $id)->delete();
                DB::table('tenants')->where('id', $id)->delete();
            }
        }

        parent::tearDown();
    }

    private function identity(string $label): CustomerIdentity
    {
        app(TenantContext::class)->set($this->tenantId);

        return CustomerIdentity::create([
            'tenant_id' => $this->tenantId, 'display_name' => $label, 'email' => $label.'-'.Str::random(5).'@pg.test',
            'password' => 'correct-horse-9', 'email_verified_at' => now(), 'is_active' => true,
        ]);
    }

    #[Test]
    public function several_processes_claiming_one_guest_order_produce_exactly_one_owner_and_one_audit_row(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $product = Product::create(['name' => 'صنف', 'sku' => 'RC-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 700, 'is_active' => true]);
        $header = ['sales_channel_id' => $this->channelId, 'storefront_id' => $this->storefrontId, 'commerce_checkout_id' => null, 'delivery_method' => 'pickup', 'delivery_amount_minor' => 0,
            'contact_name' => 'ضيف', 'contact_phone' => null, 'contact_email' => null,
            'delivery_country' => null, 'delivery_region' => null, 'delivery_city' => null, 'delivery_district' => null,
            'delivery_street' => null, 'delivery_building_no' => null, 'delivery_additional_number' => null,
            'delivery_postal_code' => null, 'delivery_notes' => null];
        $lines = [['product_id' => $product->id, 'product_name_snapshot' => 'صنف', 'quantity' => 1, 'unit_name' => null, 'unit_factor' => 1, 'unit_price' => 700, 'line_total' => 700]];
        $order = app(CommerceOrderService::class)->createFromCheckout($header, $lines);
        $this->assertNull($order->customer_identity_id);
        $number = $order->number;
        $reference = CommerceOrderReference::issue($order);

        $identities = [$this->identity('a'), $this->identity('b'), $this->identity('c')];
        [$tenant, $channel] = [$this->tenantId, $this->channelId];

        $jobs = array_map(fn (CustomerIdentity $identity) => function () use ($tenant, $channel, $number, $reference, $identity): array {
            app(TenantContext::class)->set($tenant);
            $claimed = app(CommerceOrderOwnershipClaimService::class)->claim($identity->fresh(), $channel, $number, $reference);

            return ['claimed' => $claimed !== null, 'owner' => $claimed?->customer_identity_id];
        }, [...$identities, ...$identities]); // each identity twice: also idempotent for the winner

        $results = $this->runConcurrently($jobs);
        $this->assertAllOk($results);

        $owner = DB::table('commerce_orders')->where('id', $order->id)->value('customer_identity_id');
        $this->assertContains($owner, array_map(fn ($i) => $i->id, $identities));
        $this->assertSame(1, DB::table('commerce_order_ownership_claims')->where('commerce_order_id', $order->id)->count());
        $this->assertSame($owner, DB::table('commerce_order_ownership_claims')->where('commerce_order_id', $order->id)->value('customer_identity_id'));

        foreach ($results as $result) {
            // every process that got the order got it as THE owner; nobody else saw it as theirs
            if ($result['value']['claimed']) {
                $this->assertSame($owner, $result['value']['owner']);
            }
        }
        $this->assertGreaterThanOrEqual(2, count(array_filter($results, fn ($r) => $r['value']['claimed'])), 'the winner twice (idempotent)');
        $this->assertSame(CommerceOrder::query()->withoutGlobalScopes()->whereKey($order->id)->value('customer_identity_id'), $owner);
    }

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
