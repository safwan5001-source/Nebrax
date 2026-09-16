<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\StorefrontProvisioningService;
use App\Support\ManagedStorefrontHostname;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * COM-STORE-PROVISION-1 — قفل صفّ `tenants` (مرساة `GeneratesDocumentNumbers`
 * نفسها) يسلسل طلبَي تزويد متزامنين لنفس المستأجر، فلا يُنتِجان قناة/متجر/
 * نطاق مكرَّراً. نفس نمط `StorefrontCartPostgresConcurrencyTest` (locker يحجز
 * القفل ويكتب ما كانت ستكتبه أول معاملة تزويد حقيقية، ثم يُطلِق طلب تزويد
 * حقيقي ثانٍ ليثبت أنه يتقارب لا يكرّر).
 *
 * تشغيل (PostgreSQL فقط):
 *   DB_CONNECTION=pgsql php artisan test --filter=StorefrontProvisioningPostgresConcurrencyTest
 */
class StorefrontProvisioningPostgresConcurrencyTest extends TestCase
{
    private ?Tenant $tenant = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً لإثبات أقفال الصفوف.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        config(['storefront.managed_base_domain' => 'storefronts.test']);

        $this->tenant = Tenant::create([
            'name' => 'Provisioning concurrency',
            'slug' => 'prov-concurrency-'.Str::random(8),
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
            'is_active' => true,
        ]);
    }

    protected function tearDown(): void
    {
        if ($this->tenant !== null) {
            $tenantId = $this->tenant->id;
            DB::table('storefront_domains')->where('tenant_id', $tenantId)->delete();
            DB::table('storefronts')->where('tenant_id', $tenantId)->delete();
            DB::table('sales_channels')->where('tenant_id', $tenantId)->delete();
            DB::table('tenants')->where('id', $tenantId)->delete();
        }

        parent::tearDown();
    }

    /** @test */
    public function two_concurrent_provisioning_calls_for_the_same_tenant_never_produce_a_duplicate_graph(): void
    {
        $tenantId = $this->tenant->id;
        $tenantSlug = $this->tenant->slug;
        $lockReady = $this->signalPath('prov_lock_');
        $callerStarted = $this->signalPath('prov_caller_started_');
        $resultFile = tempnam(sys_get_temp_dir(), 'prov_result_');

        // Locker: holds the exact anchor lock the service itself takes
        // (`tenants` row FOR UPDATE), simulating a first provisioning request
        // that is mid-transaction, then commits the full graph it would have
        // created — while the real second caller is already blocked waiting
        // on the very same row lock.
        $locker = pcntl_fork();
        if ($locker === 0) {
            DB::purge(config('database.default'));
            DB::transaction(function () use ($tenantId, $tenantSlug, $lockReady, $callerStarted) {
                DB::table('tenants')->where('id', $tenantId)->lockForUpdate()->first();
                touch($lockReady);
                $this->waitForSignal($callerStarted);
                usleep(500000);

                app(TenantContext::class)->set($tenantId);
                $channel = SalesChannel::create([
                    'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
                ]);
                $storefront = Storefront::create([
                    'slug' => 'main', 'name' => 'Locker storefront', 'sales_channel_id' => $channel->id, 'is_active' => true,
                ]);
                StorefrontDomain::create([
                    'storefront_id' => $storefront->id,
                    'hostname' => ManagedStorefrontHostname::forSlug($tenantSlug),
                    'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
                    'is_primary' => true,
                    'is_active' => true,
                    'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
                ]);
                app(TenantContext::class)->forget();
            });
            exit(0);
        }
        $this->assertGreaterThan(0, $locker);
        $this->waitForSignal($lockReady);

        $caller = pcntl_fork();
        if ($caller === 0) {
            DB::purge(config('database.default'));
            app(TenantContext::class)->set($tenantId);
            touch($callerStarted);
            try {
                $result = app(StorefrontProvisioningService::class)->provisionFirstStorefrontForCurrentTenant();
                file_put_contents($resultFile, json_encode(['ok' => true, 'created' => $result['created'], 'id' => $result['id']]));
            } catch (\Throwable $e) {
                file_put_contents($resultFile, json_encode(['ok' => false, 'message' => $e->getMessage()]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $caller);

        pcntl_waitpid($locker, $status);
        pcntl_waitpid($caller, $status);
        $result = json_decode((string) file_get_contents($resultFile), true);
        $this->cleanupSignals([$lockReady, $callerStarted, $resultFile]);

        $this->assertTrue($result['ok'], json_encode($result));
        // Waited for the locker's committed graph, then converged to it
        // instead of duplicating it.
        $this->assertFalse($result['created']);

        $this->assertSame(1, DB::table('sales_channels')->where('tenant_id', $tenantId)->count());
        $this->assertSame(1, DB::table('storefronts')->where('tenant_id', $tenantId)->count());
        $this->assertSame(1, DB::table('storefront_domains')->where('tenant_id', $tenantId)->count());
        $this->assertSame(
            $result['id'],
            DB::table('storefronts')->where('tenant_id', $tenantId)->value('id'),
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
