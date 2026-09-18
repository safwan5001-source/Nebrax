<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\CommerceWorkspaceStorefrontsService;
use App\Services\Commerce\Edge\FakeStorefrontEdgeClient;
use App\Services\Commerce\Edge\StorefrontEdgeClient;
use App\Services\Commerce\StorefrontDomainVerificationService;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CUSTOM-DOMAIN-EDGE-1 — سباق Activate حقيقي على PostgreSQL: قفل صفوف
 * المتجر يسلسل الطلبين، ومعرّف المزوّد واحد.
 *
 * تشغيل (PostgreSQL فقط):
 *   DB_CONNECTION=pgsql php artisan test --filter=CommerceWorkspaceActivateEdgePostgresConcurrencyTest
 */
class CommerceWorkspaceActivateEdgePostgresConcurrencyTest extends TestCase
{
    use InteractsWithApi;

    private ?Tenant $tenant = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً لإثبات قفل Activate ضد سباق حقيقي.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->tenant = Tenant::create([
            'name' => 'Edge Race',
            'slug' => 'edge-race-'.Str::random(8),
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
            'is_active' => true,
        ]);
    }

    protected function tearDown(): void
    {
        if ($this->tenant !== null) {
            DB::table('storefront_domains')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('storefronts')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('sales_channels')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('tenants')->where('id', $this->tenant->id)->delete();
        }

        parent::tearDown();
    }

    /**
     * @return array{storefront: Storefront, domain: StorefrontDomain, hostname: string}
     */
    private function seedVerifiedCustom(): array
    {
        app(TenantContext::class)->set($this->tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $hostname = 'shop.edge-race-'.Str::random(8).'.example.com';
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
            'verification_token' => StorefrontDomainVerificationService::generateToken(),
        ]);
        app(TenantContext::class)->forget();

        return ['storefront' => $storefront, 'domain' => $domain, 'hostname' => $hostname];
    }

    /** @test */
    public function concurrent_activate_persists_a_single_provider_id(): void
    {
        $seeded = $this->seedVerifiedCustom();
        $readyA = $this->signalPath('edge_act_a_');
        $readyB = $this->signalPath('edge_act_b_');
        $resultA = tempnam(sys_get_temp_dir(), 'edge_act_result_a_');
        $resultB = tempnam(sys_get_temp_dir(), 'edge_act_result_b_');
        $go = $this->signalPath('edge_act_go_');
        $expectedId = 'fake-'.substr(hash('sha256', $seeded['hostname']), 0, 32);

        $childA = pcntl_fork();
        if ($childA === 0) {
            DB::purge(config('database.default'));
            app()->instance(StorefrontEdgeClient::class, new FakeStorefrontEdgeClient());
            app(TenantContext::class)->set($this->tenant->id);
            touch($readyA);
            $this->waitForSignal($go);
            try {
                app(CommerceWorkspaceStorefrontsService::class)
                    ->activateEdgeForCurrentTenant($seeded['storefront']->id, $seeded['domain']->id);
                file_put_contents($resultA, json_encode(['ok' => true]));
            } catch (\Throwable $e) {
                file_put_contents($resultA, json_encode(['ok' => false, 'class' => get_class($e), 'message' => $e->getMessage()]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $childA);

        $childB = pcntl_fork();
        if ($childB === 0) {
            DB::purge(config('database.default'));
            app()->instance(StorefrontEdgeClient::class, new FakeStorefrontEdgeClient());
            app(TenantContext::class)->set($this->tenant->id);
            touch($readyB);
            $this->waitForSignal($go);
            try {
                app(CommerceWorkspaceStorefrontsService::class)
                    ->activateEdgeForCurrentTenant($seeded['storefront']->id, $seeded['domain']->id);
                file_put_contents($resultB, json_encode(['ok' => true]));
            } catch (\Throwable $e) {
                file_put_contents($resultB, json_encode(['ok' => false, 'class' => get_class($e), 'message' => $e->getMessage()]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $childB);

        $this->waitForSignal($readyA);
        $this->waitForSignal($readyB);
        touch($go);

        pcntl_waitpid($childA, $statusA);
        pcntl_waitpid($childB, $statusB);

        $decodedA = json_decode((string) file_get_contents($resultA), true);
        $decodedB = json_decode((string) file_get_contents($resultB), true);
        $this->cleanupSignals([$readyA, $readyB, $go, $resultA, $resultB]);

        $this->assertTrue($decodedA['ok'] ?? false, 'child A: '.json_encode($decodedA));
        $this->assertTrue($decodedB['ok'] ?? false, 'child B: '.json_encode($decodedB));

        $row = StorefrontDomain::withoutGlobalScope(TenantScope::class)->find($seeded['domain']->id);
        $this->assertNotNull($row);
        $this->assertSame($expectedId, $row->edge_provider_id);
        $this->assertContains($row->edge_status, [
            StorefrontDomain::EDGE_DNS_REQUIRED,
            StorefrontDomain::EDGE_TLS_PENDING,
            StorefrontDomain::EDGE_READY,
            StorefrontDomain::EDGE_FAILED,
        ]);
        $this->assertNotSame(StorefrontDomain::EDGE_NONE, $row->edge_status);
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
