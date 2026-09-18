<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\Edge\EdgeSnapshot;
use App\Services\Commerce\Edge\FakeStorefrontEdgeClient;
use App\Services\Commerce\Edge\StorefrontEdgeClient;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUSTOM-DOMAIN-EDGE-3 — Make Primary لنطاق مخصَّص بعد إعادة سؤال المزوّد الحي،
 * وفصل provider-first. تشغيل:
 * php artisan test --filter=CommerceWorkspaceMakePrimaryCustomEdgeApiTest
 */
class CommerceWorkspaceMakePrimaryCustomEdgeApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private FakeStorefrontEdgeClient $edge;

    protected function setUp(): void
    {
        parent::setUp();
        $this->edge = new FakeStorefrontEdgeClient();
        $this->app->instance(StorefrontEdgeClient::class, $this->edge);
    }

    private function makePrimaryPath(string $storefrontId, string $domainId): string
    {
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/domains/'.$domainId.'/make-primary';
    }

    private function disconnectPath(string $storefrontId, string $domainId): string
    {
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/domains/'.$domainId;
    }

    /**
     * @param  array<string, mixed>  $customOverrides
     * @return array{storefront: Storefront, managed: StorefrontDomain, custom: StorefrontDomain}
     */
    private function seedManagedAndCustom(string $tenantId, string $hostname, array $customOverrides = []): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $managed = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'managed-'.str_replace('.', '-', $hostname).'.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $custom = StorefrontDomain::create(array_merge([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
        ], $customOverrides));
        app(TenantContext::class)->forget();

        return ['storefront' => $storefront, 'managed' => $managed, 'custom' => $custom];
    }

    /** @test */
    public function an_unverified_custom_domain_is_rejected_without_provider_calls(): void
    {
        $auth = $this->registerTenant('e3-unverified', 'owner@e3-unverified.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'shop.e3-unverified.example.com', [
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
            'verified_at' => null,
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertStatus(422);

        $this->assertSame(0, $this->edge->fetchCalls);
        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function an_inactive_custom_domain_is_rejected(): void
    {
        $auth = $this->registerTenant('e3-inactive', 'owner@e3-inactive.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'shop.e3-inactive.example.com', [
            'is_active' => false,
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertStatus(422);

        $this->assertSame(0, $this->edge->fetchCalls);
        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function edge_none_is_rejected(): void
    {
        $auth = $this->registerTenant('e3-none', 'owner@e3-none.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'shop.e3-none.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertStatus(422);

        $this->assertSame(0, $this->edge->provisionCalls);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(StorefrontDomain::query()->find($seeded['custom']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /**
     * @test
     * @dataProvider nonReadyStatuses
     */
    public function persisted_non_ready_statuses_are_rejected(string $status, string $slug): void
    {
        $auth = $this->registerTenant($slug, 'owner@'.$slug.'.test');
        $hostname = 'shop.'.$slug.'.example.com';
        $binding = $this->edge->seedHostname($hostname, $status, 'dom-'.$slug);
        $this->edge->setSnapshotForId($binding->providerId, $status);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_status' => $status,
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertStatus(422);

        $this->assertSame(0, $this->edge->provisionCalls);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(StorefrontDomain::query()->find($seeded['custom']->id)->is_primary);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['managed']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function nonReadyStatuses(): array
    {
        return [
            'dns_required' => [EdgeSnapshot::STATUS_DNS_REQUIRED, 'e3dnsreq'],
            'tls_pending' => [EdgeSnapshot::STATUS_TLS_PENDING, 'e3tlspend'],
            'failed' => [EdgeSnapshot::STATUS_FAILED, 'e3failed'],
        ];
    }

    /** @test */
    public function persisted_ready_with_live_provider_not_ready_is_rejected_and_persists_the_refresh(): void
    {
        $auth = $this->registerTenant('e3staleready', 'owner@e3staleready.test');
        $hostname = 'shop.e3staleready.example.com';
        $binding = $this->edge->seedHostname($hostname, EdgeSnapshot::STATUS_TLS_PENDING, 'dom-e3-stale-tls');
        $this->edge->setSnapshotForId($binding->providerId, EdgeSnapshot::STATUS_TLS_PENDING);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_status' => StorefrontDomain::EDGE_READY,
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
            'edge_ready_at' => now(),
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $row = StorefrontDomain::query()->find($seeded['custom']->id);
        $this->assertFalse($row->is_primary);
        $this->assertSame(StorefrontDomain::EDGE_TLS_PENDING, $row->edge_status);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['managed']->id)->is_primary);
        app(TenantContext::class)->forget();
        $this->assertSame(0, $this->edge->provisionCalls);
        $this->assertGreaterThan(0, $this->edge->fetchCalls);
    }

    /** @test */
    public function persisted_ready_with_provider_outage_fails_closed_without_promotion(): void
    {
        $auth = $this->registerTenant('e3-outage', 'owner@e3-outage.test');
        $hostname = 'shop.e3-outage.example.com';
        $binding = $this->edge->seedHostname($hostname, EdgeSnapshot::STATUS_READY);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_status' => StorefrontDomain::EDGE_READY,
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
            'edge_ready_at' => now(),
        ]);
        $this->edge->fetchFailure = 'unavailable';

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertStatus(503);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(StorefrontDomain::query()->find($seeded['custom']->id)->is_primary);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['managed']->id)->is_primary);
        app(TenantContext::class)->forget();
        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function persisted_ready_with_provider_missing_is_rejected(): void
    {
        $auth = $this->registerTenant('e3-missing', 'owner@e3-missing.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'shop.e3-missing.example.com', [
            'edge_status' => StorefrontDomain::EDGE_READY,
            'edge_provider' => 'railway',
            'edge_provider_id' => 'stale-dom-id',
            'edge_ready_at' => now(),
        ]);
        $this->edge->unknownIdsAreMissing = true;

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(StorefrontDomain::query()->find($seeded['custom']->id)->is_primary);
        app(TenantContext::class)->forget();
        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function live_provider_ready_promotes_the_custom_domain_and_keeps_exactly_one_primary(): void
    {
        $auth = $this->registerTenant('e3-live-ready', 'owner@e3-live-ready.test');
        $hostname = 'shop.e3-live-ready.example.com';
        $binding = $this->edge->seedHostname($hostname, EdgeSnapshot::STATUS_READY);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_status' => StorefrontDomain::EDGE_DNS_REQUIRED,
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
        ]);

        $res = $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertOk();

        $this->assertTrue($res->json('data.domain.is_primary'));
        $this->assertSame(StorefrontDomain::EDGE_READY, $res->json('data.domain.edge.status'));
        $this->assertSame(0, $this->edge->provisionCalls);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['custom']->id)->is_primary);
        $this->assertFalse(StorefrontDomain::query()->find($seeded['managed']->id)->is_primary);
        $this->assertSame(1, StorefrontDomain::query()->where('storefront_id', $seeded['storefront']->id)->where('is_primary', true)->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function repeated_make_primary_on_an_already_primary_live_ready_custom_domain_is_idempotent(): void
    {
        $auth = $this->registerTenant('e3-idempotent', 'owner@e3-idempotent.test');
        $hostname = 'shop.e3-idempotent.example.com';
        $binding = $this->edge->seedHostname($hostname, EdgeSnapshot::STATUS_READY);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_status' => StorefrontDomain::EDGE_READY,
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
            'edge_ready_at' => now(),
        ]);

        app(TenantContext::class)->set($auth['tenant_id']);
        $seeded['managed']->forceFill(['is_primary' => false])->save();
        $seeded['custom']->forceFill(['is_primary' => true])->save();
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertOk()
            ->assertJsonPath('data.domain.is_primary', true);

        $this->assertSame(0, $this->edge->provisionCalls);
        $this->assertGreaterThan(0, $this->edge->fetchCalls);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['custom']->id)->is_primary);
        $this->assertFalse(StorefrontDomain::query()->find($seeded['managed']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function awj_managed_make_primary_does_not_require_edge_state(): void
    {
        $auth = $this->registerTenant('e3-awj', 'owner@e3-awj.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'shop.e3-awj.example.com');

        app(TenantContext::class)->set($auth['tenant_id']);
        $other = StorefrontDomain::create([
            'storefront_id' => $seeded['storefront']->id,
            'hostname' => 'other-e3-awj.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $other->id))
            ->assertOk();

        $this->assertSame(0, $this->edge->fetchCalls);
        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function guest_make_primary_is_unauthorized(): void
    {
        $auth = $this->registerTenant('e3-guest', 'owner@e3-guest.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'shop.e3-guest.example.com');

        $this->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertUnauthorized();
        $this->assertSame(0, $this->edge->fetchCalls);
    }

    /** @test */
    public function self_service_make_primary_is_forbidden(): void
    {
        $auth = $this->registerTenant('e3-ss', 'owner@e3-ss.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'shop.e3-ss.example.com');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@e3-ss.test');

        $this->withToken($ss)
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertForbidden();
        $this->assertSame(0, $this->edge->fetchCalls);
    }

    /** @test */
    public function staff_without_commerce_manage_is_forbidden(): void
    {
        $auth = $this->registerTenant('e3-staff', 'owner@e3-staff.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'shop.e3-staff.example.com');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@e3-staff.test');

        $this->withToken($staff)
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertForbidden();
        $this->assertSame(0, $this->edge->fetchCalls);
    }

    /** @test */
    public function cross_tenant_make_primary_returns_404_without_provider_calls(): void
    {
        $a = $this->registerTenant('e3-idor-a', 'owner@e3-idor-a.test');
        $b = $this->registerTenant('e3-idor-b', 'owner@e3-idor-b.test');
        $seededB = $this->seedManagedAndCustom($b['tenant_id'], 'shop.e3-idor-b.example.com');

        $this->withToken($a['token'])
            ->postJson($this->makePrimaryPath($seededB['storefront']->id, $seededB['custom']->id))
            ->assertNotFound();

        $this->assertSame(0, $this->edge->fetchCalls);
        $this->assertSame(0, $this->edge->releaseCalls);
    }

    /** @test */
    public function disconnect_releases_provider_before_local_delete(): void
    {
        $auth = $this->registerTenant('e3-dc-rel', 'owner@e3-dc-rel.test');
        $hostname = 'shop.e3-dc-rel.example.com';
        $binding = $this->edge->seedHostname($hostname, EdgeSnapshot::STATUS_READY);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_status' => StorefrontDomain::EDGE_READY,
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
        ]);

        $this->withToken($auth['token'])
            ->deleteJson($this->disconnectPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertOk();

        $this->assertSame(1, $this->edge->releaseCalls);
        $this->assertArrayNotHasKey($binding->providerId, $this->edge->byId);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNull(StorefrontDomain::query()->find($seeded['custom']->id));
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['managed']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function disconnect_with_provider_already_absent_deletes_the_local_row(): void
    {
        $auth = $this->registerTenant('e3-dc-absent', 'owner@e3-dc-absent.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'shop.e3-dc-absent.example.com', [
            'edge_status' => StorefrontDomain::EDGE_FAILED,
            'edge_provider' => 'railway',
            'edge_provider_id' => 'already-gone',
        ]);

        $this->withToken($auth['token'])
            ->deleteJson($this->disconnectPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertOk();

        $this->assertSame(0, $this->edge->releaseCalls);
        $this->assertSame(0, $this->edge->provisionCalls);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNull(StorefrontDomain::query()->find($seeded['custom']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function disconnect_provider_timeout_keeps_the_local_row(): void
    {
        $auth = $this->registerTenant('e3-dc-timeout', 'owner@e3-dc-timeout.test');
        $hostname = 'shop.e3-dc-timeout.example.com';
        $binding = $this->edge->seedHostname($hostname, EdgeSnapshot::STATUS_READY);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
        ]);
        $this->edge->releaseFailure = 'unavailable';

        $this->withToken($auth['token'])
            ->deleteJson($this->disconnectPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertStatus(503);

        $this->assertSame(1, $this->edge->releaseCalls);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['custom']->id));
        app(TenantContext::class)->forget();
        $this->assertArrayHasKey($binding->providerId, $this->edge->byId);
    }

    /** @test */
    public function disconnect_of_current_primary_rejects_before_provider_release(): void
    {
        $auth = $this->registerTenant('e3-dc-primary', 'owner@e3-dc-primary.test');
        $hostname = 'shop.e3-dc-primary.example.com';
        $binding = $this->edge->seedHostname($hostname, EdgeSnapshot::STATUS_READY);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
        ]);

        app(TenantContext::class)->set($auth['tenant_id']);
        $seeded['managed']->forceFill(['is_primary' => false])->save();
        $seeded['custom']->forceFill(['is_primary' => true])->save();
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->deleteJson($this->disconnectPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertStatus(422);

        $this->assertSame(0, $this->edge->releaseCalls);
        $this->assertSame(0, $this->edge->findCalls);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['custom']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function repeated_disconnect_after_confirmed_absence_is_404(): void
    {
        $auth = $this->registerTenant('e3-dc-repeat', 'owner@e3-dc-repeat.test');
        $hostname = 'shop.e3-dc-repeat.example.com';
        $binding = $this->edge->seedHostname($hostname, EdgeSnapshot::STATUS_READY);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
        ]);

        $this->withToken($auth['token'])
            ->deleteJson($this->disconnectPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertOk();

        $this->withToken($auth['token'])
            ->deleteJson($this->disconnectPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertNotFound();

        $this->assertSame(1, $this->edge->releaseCalls);
        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function unique_primary_invariant_holds_after_custom_promotion(): void
    {
        $auth = $this->registerTenant('e3-unique', 'owner@e3-unique.test');
        $hostname = 'shop.e3-unique.example.com';
        $binding = $this->edge->seedHostname($hostname, EdgeSnapshot::STATUS_READY);
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], $hostname, [
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->makePrimaryPath($seeded['storefront']->id, $seeded['custom']->id))
            ->assertOk();

        $this->assertSame(
            1,
            StorefrontDomain::withoutGlobalScope(TenantScope::class)
                ->where('storefront_id', $seeded['storefront']->id)
                ->where('is_primary', true)
                ->count()
        );
    }
}
