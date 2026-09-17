<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\CommerceWorkspaceStorefrontsService;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * STORE-ADMIN-ADOPT-1B-3A — إثبات أن قيد `unique(hostname)` على
 * `storefront_domains` (لا فحص التطبيق المسبق وحده) هو ما يحسم فعلياً سباقاً
 * حقيقياً بين مستأجرَين مختلفَين يحاولان تسجيل **نفس** hostname كنطاق مخصَّص
 * في اللحظة نفسها — والخاسر يتحوّل إلى رفض آمن (409 عبر `StorefrontHostnameConflictException`)
 * لا استثناء قاعدة بيانات خام غير مُلتقَط.
 *
 * نفس نمط `StorefrontProvisioningPostgresConcurrencyTest` (locker يحجز
 * الصفّ الفعلي داخل معاملة مفتوحة، ثم عملية ثانية حقيقية تصطدم به).
 *
 * تشغيل (PostgreSQL فقط):
 *   DB_CONNECTION=pgsql php artisan test --filter=CommerceWorkspaceCustomDomainPostgresConcurrencyTest
 */
class CommerceWorkspaceCustomDomainPostgresConcurrencyTest extends TestCase
{
    use InteractsWithApi;

    private ?Tenant $tenantA = null;

    private ?Tenant $tenantB = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً لإثبات قيد التفرّد ضد سباق حقيقي.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $suffix = Str::random(8);
        $this->tenantA = Tenant::create([
            'name' => 'Race A', 'slug' => 'race-a-'.$suffix, 'vat_number' => '300000000000003',
            'currency' => 'SAR', 'is_active' => true,
        ]);
        $this->tenantB = Tenant::create([
            'name' => 'Race B', 'slug' => 'race-b-'.$suffix, 'vat_number' => '300000000000003',
            'currency' => 'SAR', 'is_active' => true,
        ]);
    }

    protected function tearDown(): void
    {
        foreach ([$this->tenantA, $this->tenantB] as $tenant) {
            if ($tenant === null) {
                continue;
            }
            DB::table('storefront_domains')->where('tenant_id', $tenant->id)->delete();
            DB::table('storefronts')->where('tenant_id', $tenant->id)->delete();
            DB::table('sales_channels')->where('tenant_id', $tenant->id)->delete();
            DB::table('tenants')->where('id', $tenant->id)->delete();
        }

        parent::tearDown();
    }

    private function seedStorefront(Tenant $tenant): Storefront
    {
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return $storefront;
    }

    /** @test */
    public function two_different_tenants_racing_for_the_same_hostname_never_both_succeed(): void
    {
        $storefrontA = $this->seedStorefront($this->tenantA);
        $storefrontB = $this->seedStorefront($this->tenantB);
        $raceHostname = 'race-'.Str::random(8).'.example.com';

        $lockReady = $this->signalPath('domain_race_lock_');
        $callerStarted = $this->signalPath('domain_race_caller_');
        $resultFile = tempnam(sys_get_temp_dir(), 'domain_race_result_');

        // Locker: tenant A inserts the contested hostname inside an open
        // (uncommitted) transaction and holds it — simulating a first Add
        // Custom Domain request that is mid-flight.
        $locker = pcntl_fork();
        if ($locker === 0) {
            DB::purge(config('database.default'));
            DB::beginTransaction();
            app(TenantContext::class)->set($this->tenantA->id);
            StorefrontDomain::create([
                'storefront_id' => $storefrontA->id,
                'hostname' => $raceHostname,
                'type' => StorefrontDomain::TYPE_CUSTOM,
                'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
                'verification_token' => bin2hex(random_bytes(24)),
            ]);
            app(TenantContext::class)->forget();
            touch($lockReady);
            $this->waitForSignal($callerStarted);
            usleep(500000);
            DB::commit();
            exit(0);
        }
        $this->assertGreaterThan(0, $locker);
        $this->waitForSignal($lockReady);

        // Caller: tenant B's real Add Custom Domain call for the same
        // hostname, via the actual service (not a raw insert) — it must
        // block on the row lock, then receive a clean conflict once the
        // locker commits, never an uncaught QueryException/500.
        $caller = pcntl_fork();
        if ($caller === 0) {
            DB::purge(config('database.default'));
            app(TenantContext::class)->set($this->tenantB->id);
            touch($callerStarted);
            try {
                app(CommerceWorkspaceStorefrontsService::class)
                    ->addCustomDomainForCurrentTenant($storefrontB->id, $raceHostname);
                file_put_contents($resultFile, json_encode(['ok' => true]));
            } catch (\App\Services\Commerce\StorefrontHostnameConflictException $e) {
                file_put_contents($resultFile, json_encode(['ok' => false, 'conflict' => true, 'message' => $e->getMessage()]));
            } catch (\Throwable $e) {
                file_put_contents($resultFile, json_encode(['ok' => false, 'conflict' => false, 'class' => get_class($e), 'message' => $e->getMessage()]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $caller);

        pcntl_waitpid($locker, $status);
        pcntl_waitpid($caller, $status);
        $result = json_decode((string) file_get_contents($resultFile), true);
        $this->cleanupSignals([$lockReady, $callerStarted, $resultFile]);

        $this->assertFalse($result['ok'], json_encode($result));
        $this->assertTrue($result['conflict'] ?? false, 'يجب أن يتحوّل السباق إلى تعارضٍ آمن لا استثناءً خاماً: '.json_encode($result));

        $this->assertSame(
            1,
            StorefrontDomain::withoutGlobalScope(TenantScope::class)->where('hostname', $raceHostname)->count(),
        );
        $winner = StorefrontDomain::withoutGlobalScope(TenantScope::class)->where('hostname', $raceHostname)->first();
        $this->assertSame($this->tenantA->id, $winner->tenant_id);
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
