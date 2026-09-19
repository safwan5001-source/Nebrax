<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\CommerceWorkspaceStorefrontsService;
use App\Services\Commerce\CustomDomainNotReadyForPrimaryException;
use App\Services\Commerce\DomainNotDisconnectableException;
use App\Services\Commerce\DomainNotEligibleForPrimaryException;
use App\Services\Commerce\Edge\EdgeSnapshot;
use App\Services\Commerce\Edge\FakeStorefrontEdgeClient;
use App\Services\Commerce\Edge\StorefrontEdgeClient;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CUSTOM-DOMAIN-EDGE-3 — سباق Disconnect ↔ Make Primary على نطاق مخصَّص
 * جاهز حيّاً لا يترك Primary محلياً بعد إطلاق Railway.
 *
 * تشغيل (PostgreSQL فقط):
 *   DB_CONNECTION=pgsql php artisan test --filter=CommerceWorkspaceDisconnectMakePrimaryPostgresConcurrencyTest
 */
class CommerceWorkspaceDisconnectMakePrimaryPostgresConcurrencyTest extends TestCase
{
    use InteractsWithApi;

    private ?Tenant $tenant = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً لإثبات سباق Disconnect وMake Primary.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->tenant = Tenant::create([
            'name' => 'Disconnect Primary Race',
            'slug' => 'dc-primary-race-'.Str::random(8),
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
     * @return array{storefront: Storefront, managed: StorefrontDomain, custom: StorefrontDomain, hostname: string, providerId: string}
     */
    private function seedLiveReadyCustomBesideManagedPrimary(): array
    {
        app(TenantContext::class)->set($this->tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $suffix = Str::random(8);
        $managed = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'managed-'.$suffix.'.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $hostname = 'shop-race-'.$suffix.'.example.com';
        $providerId = 'dom-race-'.$suffix;
        $custom = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
            'edge_status' => StorefrontDomain::EDGE_READY,
            'edge_provider' => 'railway',
            'edge_provider_id' => $providerId,
            'edge_ready_at' => now(),
        ]);
        app(TenantContext::class)->forget();

        return [
            'storefront' => $storefront,
            'managed' => $managed,
            'custom' => $custom,
            'hostname' => $hostname,
            'providerId' => $providerId,
        ];
    }

    /** @test */
    public function concurrent_disconnect_and_make_primary_never_leave_primary_without_provider_binding(): void
    {
        $seeded = $this->seedLiveReadyCustomBesideManagedPrimary();
        $readyA = $this->signalPath('e3_dc_mp_a_');
        $readyB = $this->signalPath('e3_dc_mp_b_');
        $resultA = tempnam(sys_get_temp_dir(), 'e3_dc_mp_result_a_');
        $resultB = tempnam(sys_get_temp_dir(), 'e3_dc_mp_result_b_');
        $go = $this->signalPath('e3_dc_mp_go_');

        $childA = pcntl_fork();
        if ($childA === 0) {
            DB::purge(config('database.default'));
            $edge = new FakeStorefrontEdgeClient();
            $edge->seedHostname($seeded['hostname'], EdgeSnapshot::STATUS_READY, $seeded['providerId']);
            app()->instance(StorefrontEdgeClient::class, $edge);
            app(TenantContext::class)->set($this->tenant->id);
            touch($readyA);
            $this->waitForSignal($go);
            try {
                app(CommerceWorkspaceStorefrontsService::class)
                    ->disconnectCustomDomainForCurrentTenant($seeded['storefront']->id, $seeded['custom']->id);
                file_put_contents($resultA, json_encode([
                    'op' => 'disconnect',
                    'ok' => true,
                    'releaseCalls' => $edge->releaseCalls,
                ]));
            } catch (DomainNotDisconnectableException $e) {
                file_put_contents($resultA, json_encode([
                    'op' => 'disconnect',
                    'ok' => false,
                    'class' => DomainNotDisconnectableException::class,
                    'releaseCalls' => $edge->releaseCalls,
                    'message' => $e->getMessage(),
                ]));
            } catch (\Throwable $e) {
                file_put_contents($resultA, json_encode([
                    'op' => 'disconnect',
                    'ok' => false,
                    'class' => get_class($e),
                    'releaseCalls' => $edge->releaseCalls,
                    'message' => $e->getMessage(),
                ]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $childA);

        $childB = pcntl_fork();
        if ($childB === 0) {
            DB::purge(config('database.default'));
            $edge = new FakeStorefrontEdgeClient();
            $edge->seedHostname($seeded['hostname'], EdgeSnapshot::STATUS_READY, $seeded['providerId']);
            app()->instance(StorefrontEdgeClient::class, $edge);
            app(TenantContext::class)->set($this->tenant->id);
            touch($readyB);
            $this->waitForSignal($go);
            try {
                $presented = app(CommerceWorkspaceStorefrontsService::class)
                    ->makePrimaryForCurrentTenant($seeded['storefront']->id, $seeded['custom']->id);
                if ($presented === null) {
                    file_put_contents($resultB, json_encode([
                        'op' => 'make_primary',
                        'ok' => false,
                        'reason' => 'missing',
                        'provisionCalls' => $edge->provisionCalls,
                    ]));
                } else {
                    file_put_contents($resultB, json_encode([
                        'op' => 'make_primary',
                        'ok' => true,
                        'is_primary' => $presented['is_primary'] ?? null,
                        'provisionCalls' => $edge->provisionCalls,
                    ]));
                }
            } catch (CustomDomainNotReadyForPrimaryException|DomainNotEligibleForPrimaryException $e) {
                file_put_contents($resultB, json_encode([
                    'op' => 'make_primary',
                    'ok' => false,
                    'class' => get_class($e),
                    'provisionCalls' => $edge->provisionCalls,
                    'message' => $e->getMessage(),
                ]));
            } catch (\Throwable $e) {
                file_put_contents($resultB, json_encode([
                    'op' => 'make_primary',
                    'ok' => false,
                    'class' => get_class($e),
                    'provisionCalls' => $edge->provisionCalls,
                    'message' => $e->getMessage(),
                ]));
            }
            exit(0);
        }
        $this->assertGreaterThan(0, $childB);

        $this->waitForSignal($readyA);
        $this->waitForSignal($readyB);
        touch($go);

        pcntl_waitpid($childA, $statusA);
        pcntl_waitpid($childB, $statusB);

        $disconnect = json_decode((string) file_get_contents($resultA), true);
        $makePrimary = json_decode((string) file_get_contents($resultB), true);
        $this->cleanupSignals([$readyA, $readyB, $go, $resultA, $resultB]);

        $this->assertIsArray($disconnect, 'disconnect child produced no result');
        $this->assertIsArray($makePrimary, 'make-primary child produced no result');
        $this->assertSame(0, $makePrimary['provisionCalls'] ?? -1);

        $released = ((int) ($disconnect['releaseCalls'] ?? 0)) > 0;
        $row = StorefrontDomain::withoutGlobalScope(TenantScope::class)->find($seeded['custom']->id);
        $isPrimary = $row !== null && $row->is_primary === true;

        $this->assertFalse(
            $isPrimary && $released,
            'Primary custom row remained after Railway release. disconnect='.json_encode($disconnect).' makePrimary='.json_encode($makePrimary)
        );

        if ($row === null) {
            $this->assertTrue($released || ($disconnect['ok'] ?? false), 'local delete without provider reconciliation: '.json_encode($disconnect));
            $this->assertFalse($makePrimary['ok'] ?? false, 'Make Primary succeeded after the row was deleted: '.json_encode($makePrimary));
            $this->assertTrue(
                StorefrontDomain::withoutGlobalScope(TenantScope::class)->find($seeded['managed']->id)?->is_primary === true
            );
        } else {
            $this->assertFalse($released);
            $this->assertTrue($isPrimary);
            $this->assertTrue($row->is_active);
            $this->assertSame($seeded['providerId'], $row->edge_provider_id);
            $this->assertTrue($makePrimary['ok'] ?? false, 'expected Make Primary to win: '.json_encode($makePrimary));
            $this->assertFalse($disconnect['ok'] ?? true, 'expected Disconnect to reject primary: '.json_encode($disconnect));
            $this->assertSame(0, (int) ($disconnect['releaseCalls'] ?? -1));
        }

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
        $deadline = microtime(true) + 8.0;
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
