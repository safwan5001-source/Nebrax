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
 * STORE-ADMIN-ADOPT-1B-3B — إثبات أن قفل صفوف نطاقات المتجر داخل المعاملة
 * يحسم سباق Make Primary حقيقياً: نطاقان AWJ مؤهَّلان يتسابقان ليصبحا
 * الأساسي، والنتيجة صفّ أساسي نشط واحد فقط — لا صفّان ولا 500 خام.
 *
 * تشغيل (PostgreSQL فقط):
 *   DB_CONNECTION=pgsql php artisan test --filter=CommerceWorkspaceDomainLifecyclePostgresConcurrencyTest
 */
class CommerceWorkspaceDomainLifecyclePostgresConcurrencyTest extends TestCase
{
    use InteractsWithApi;

    private ?Tenant $tenant = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً لإثبات قفل Make Primary ضد سباق حقيقي.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->tenant = Tenant::create([
            'name' => 'Lifecycle Race',
            'slug' => 'lifecycle-race-'.Str::random(8),
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
     * @return array{storefront: Storefront, first: StorefrontDomain, second: StorefrontDomain}
     */
    private function seedTwoEligibleAwjDomains(): array
    {
        app(TenantContext::class)->set($this->tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $suffix = Str::random(8);
        $first = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'race-a-'.$suffix.'.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $second = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'race-b-'.$suffix.'.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return ['storefront' => $storefront, 'first' => $first, 'second' => $second];
    }

    /** @test */
    public function concurrent_make_primary_on_two_eligible_awj_domains_leaves_exactly_one_primary(): void
    {
        $seeded = $this->seedTwoEligibleAwjDomains();
        $readyA = $this->signalPath('mp_race_a_');
        $readyB = $this->signalPath('mp_race_b_');
        $resultA = tempnam(sys_get_temp_dir(), 'mp_race_result_a_');
        $resultB = tempnam(sys_get_temp_dir(), 'mp_race_result_b_');
        $go = $this->signalPath('mp_race_go_');

        $childA = pcntl_fork();
        if ($childA === 0) {
            DB::purge(config('database.default'));
            app(TenantContext::class)->set($this->tenant->id);
            touch($readyA);
            $this->waitForSignal($go);
            try {
                app(CommerceWorkspaceStorefrontsService::class)
                    ->makePrimaryForCurrentTenant($seeded['storefront']->id, $seeded['first']->id);
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
            app(TenantContext::class)->set($this->tenant->id);
            touch($readyB);
            $this->waitForSignal($go);
            try {
                app(CommerceWorkspaceStorefrontsService::class)
                    ->makePrimaryForCurrentTenant($seeded['storefront']->id, $seeded['second']->id);
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

        $this->assertSame(
            1,
            StorefrontDomain::withoutGlobalScope(TenantScope::class)
                ->where('storefront_id', $seeded['storefront']->id)
                ->where('is_primary', true)
                ->where('is_active', true)
                ->count()
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
