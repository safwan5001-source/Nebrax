<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\Edge\EdgeSnapshot;
use App\Services\Commerce\Edge\FakeStorefrontEdgeClient;
use App\Services\Commerce\Edge\StorefrontEdgeClient;
use App\Services\Commerce\StorefrontDomainVerificationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUSTOM-DOMAIN-EDGE-1 — `POST .../domains/{domainId}/refresh-edge`.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceRefreshEdgeApiTest
 */
class CommerceWorkspaceRefreshEdgeApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private FakeStorefrontEdgeClient $edge;

    protected function setUp(): void
    {
        parent::setUp();
        config(['storefront.managed_base_domain' => 'store.awjdev.test']);
        $this->edge = new FakeStorefrontEdgeClient();
        $this->app->instance(StorefrontEdgeClient::class, $this->edge);
    }

    private function path(string $storefrontId, string $domainId): string
    {
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/domains/'.$domainId.'/refresh-edge';
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array{storefront: Storefront, domain: StorefrontDomain}
     */
    private function seedCustom(string $tenantId, string $hostname, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $domain = StorefrontDomain::create(array_merge([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
            'verification_token' => StorefrontDomainVerificationService::generateToken(),
        ], $overrides));
        app(TenantContext::class)->forget();

        return ['storefront' => $storefront, 'domain' => $domain];
    }

    private function seedActivated(string $tenantId, string $hostname, string $status = EdgeSnapshot::STATUS_DNS_REQUIRED): array
    {
        $seeded = $this->seedCustom($tenantId, $hostname);
        $binding = $this->edge->seedHostname($hostname, $status);
        app(TenantContext::class)->set($tenantId);
        $seeded['domain']->forceFill([
            'edge_status' => StorefrontDomain::EDGE_DNS_REQUIRED,
            'edge_provider' => 'railway',
            'edge_provider_id' => $binding->providerId,
            'edge_checked_at' => now()->subMinute(),
        ])->save();
        app(TenantContext::class)->forget();

        return $seeded;
    }

    /** @test */
    public function refresh_maps_dns_required(): void
    {
        $auth = $this->registerTenant('edge-ref-dns', 'owner@edge-ref-dns.test');
        $seeded = $this->seedActivated($auth['tenant_id'], 'shop.edge-ref-dns.example.com', EdgeSnapshot::STATUS_DNS_REQUIRED);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertSame(StorefrontDomain::EDGE_DNS_REQUIRED, $res->json('data.domain.edge.status'));
        $this->assertNull($res->json('data.domain.edge.ready_at'));
    }

    /** @test */
    public function refresh_maps_tls_pending(): void
    {
        $auth = $this->registerTenant('edge-ref-tls', 'owner@edge-ref-tls.test');
        $seeded = $this->seedActivated($auth['tenant_id'], 'shop.edge-ref-tls.example.com', EdgeSnapshot::STATUS_TLS_PENDING);
        $this->edge->setSnapshotForId($seeded['domain']->fresh()->edge_provider_id, EdgeSnapshot::STATUS_TLS_PENDING);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertSame(StorefrontDomain::EDGE_TLS_PENDING, $res->json('data.domain.edge.status'));
        $this->assertNull($res->json('data.domain.edge.ready_at'));
    }

    /** @test */
    public function refresh_maps_ready_from_authoritative_certificate_only(): void
    {
        $auth = $this->registerTenant('edge-ref-ready', 'owner@edge-ref-ready.test');
        $seeded = $this->seedActivated($auth['tenant_id'], 'shop.edge-ref-ready.example.com');
        $this->edge->setSnapshotForId($seeded['domain']->fresh()->edge_provider_id, EdgeSnapshot::STATUS_READY);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertSame(StorefrontDomain::EDGE_READY, $res->json('data.domain.edge.status'));
        $this->assertNotNull($res->json('data.domain.edge.ready_at'));
        $this->assertSame(StorefrontDomain::VERIFICATION_VERIFIED, $res->json('data.domain.verification_status'));
    }

    /** @test */
    public function refresh_maps_failed(): void
    {
        $auth = $this->registerTenant('edge-ref-failed', 'owner@edge-ref-failed.test');
        $seeded = $this->seedActivated($auth['tenant_id'], 'shop.edge-ref-failed.example.com');
        $this->edge->setSnapshotForId($seeded['domain']->fresh()->edge_provider_id, EdgeSnapshot::STATUS_FAILED);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertSame(StorefrontDomain::EDGE_FAILED, $res->json('data.domain.edge.status'));
        $this->assertNotNull($res->json('data.domain.edge.last_error'));
        $this->assertNotSame(StorefrontDomain::EDGE_READY, $res->json('data.domain.edge.status'));
    }

    /** @test */
    public function missing_provider_object_marks_failed_and_keeps_the_row(): void
    {
        $this->edge->unknownIdsAreMissing = true;
        $auth = $this->registerTenant('edge-ref-missing', 'owner@edge-ref-missing.test');
        $seeded = $this->seedCustom($auth['tenant_id'], 'shop.edge-ref-missing.example.com', [
            'edge_status' => StorefrontDomain::EDGE_DNS_REQUIRED,
            'edge_provider' => 'railway',
            'edge_provider_id' => 'gone-from-railway',
        ]);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertSame(StorefrontDomain::EDGE_FAILED, $res->json('data.domain.edge.status'));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['domain']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function provider_timeout_returns_503_and_does_not_mark_ready(): void
    {
        $this->edge->fetchFailure = 'unavailable';
        $auth = $this->registerTenant('edge-ref-timeout', 'owner@edge-ref-timeout.test');
        $seeded = $this->seedActivated($auth['tenant_id'], 'shop.edge-ref-timeout.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(503);

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertSame(StorefrontDomain::EDGE_DNS_REQUIRED, $stored->edge_status);
        $this->assertNotSame(StorefrontDomain::EDGE_READY, $stored->edge_status);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function client_cannot_force_ready_via_the_request_body(): void
    {
        $auth = $this->registerTenant('edge-ref-authz', 'owner@edge-ref-authz.test');
        $seeded = $this->seedActivated($auth['tenant_id'], 'shop.edge-ref-authz.example.com', EdgeSnapshot::STATUS_DNS_REQUIRED);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id), [
                'edge_status' => StorefrontDomain::EDGE_READY,
                'tls_ready' => true,
                'certificate_status' => 'CERTIFICATE_STATUS_TYPE_VALID',
            ])
            ->assertOk();

        $this->assertSame(StorefrontDomain::EDGE_DNS_REQUIRED, $res->json('data.domain.edge.status'));
        $this->assertNotSame(StorefrontDomain::EDGE_READY, $res->json('data.domain.edge.status'));
    }

    /** @test */
    public function refresh_without_activation_returns_422(): void
    {
        $auth = $this->registerTenant('edge-ref-none', 'owner@edge-ref-none.test');
        $seeded = $this->seedCustom($auth['tenant_id'], 'shop.edge-ref-none.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(422);
    }

    /** @test */
    public function awj_managed_refresh_is_rejected(): void
    {
        $auth = $this->registerTenant('edge-ref-awj', 'owner@edge-ref-awj.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $managed = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'edge-ref-awj.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson($this->path($storefront->id, $managed->id))
            ->assertStatus(422);
    }

    /** @test */
    public function a_cross_tenant_domain_returns_404(): void
    {
        $a = $this->registerTenant('edge-ref-idor-a', 'owner@edge-ref-idor-a.test');
        $b = $this->registerTenant('edge-ref-idor-b', 'owner@edge-ref-idor-b.test');
        $seededB = $this->seedActivated($b['tenant_id'], 'shop.edge-ref-idor-b.example.com');

        $this->withToken($a['token'])
            ->postJson($this->path($seededB['storefront']->id, $seededB['domain']->id))
            ->assertNotFound();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('edge-ref-guest', 'owner@edge-ref-guest.test');
        $seeded = $this->seedActivated($auth['tenant_id'], 'shop.edge-ref-guest.example.com');

        $this->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertUnauthorized();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('edge-ref-ss', 'owner@edge-ref-ss.test');
        $seeded = $this->seedActivated($auth['tenant_id'], 'shop.edge-ref-ss.example.com');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@edge-ref-ss.test');

        $this->withToken($ss)
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertForbidden();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('edge-ref-staff', 'owner@edge-ref-staff.test');
        $seeded = $this->seedActivated($auth['tenant_id'], 'shop.edge-ref-staff.example.com');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@edge-ref-staff.test');

        $this->withToken($staff)
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertForbidden();
    }
}
