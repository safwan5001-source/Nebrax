<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\Edge\FakeStorefrontEdgeClient;
use App\Services\Commerce\Edge\StorefrontEdgeClient;
use App\Services\Commerce\StorefrontDomainVerificationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUSTOM-DOMAIN-EDGE-1 — `POST .../domains/{domainId}/activate-edge`.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceActivateEdgeApiTest
 */
class CommerceWorkspaceActivateEdgeApiTest extends TestCase
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
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/domains/'.$domainId.'/activate-edge';
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array{storefront: Storefront, domain: StorefrontDomain, managed: StorefrontDomain}
     */
    private function seedVerifiedCustom(string $tenantId, string $hostname, array $overrides = []): array
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
            'hostname' => 'managed-'.$hostname,
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
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

        return ['storefront' => $storefront, 'domain' => $domain, 'managed' => $managed];
    }

    /** @test */
    public function an_authorized_owner_can_activate_a_verified_custom_subdomain(): void
    {
        $auth = $this->registerTenant('edge-act-owner', 'owner@edge-act-owner.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-owner.example.com');

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $edge = $res->json('data.domain.edge');
        $this->assertSame(StorefrontDomain::EDGE_DNS_REQUIRED, $edge['status']);
        $this->assertNotEmpty($edge['dns_instructions']['records']);
        $this->assertSame('CNAME', $edge['dns_instructions']['records'][0]['type']);
        $this->assertSame('shop.edge-act-owner.example.com', $edge['dns_instructions']['records'][0]['name']);
        $this->assertNotNull($edge['checked_at']);
        $this->assertNull($edge['ready_at']);
        $this->assertArrayNotHasKey('provider_id', $edge);
        $this->assertArrayNotHasKey('edge_provider_id', $res->json('data.domain'));
        $this->assertSame(1, $this->edge->provisionCalls);
        $this->assertSame(StorefrontDomain::VERIFICATION_VERIFIED, $res->json('data.domain.verification_status'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertSame(StorefrontDomain::EDGE_DNS_REQUIRED, $stored->edge_status);
        $this->assertSame('railway', $stored->edge_provider);
        $this->assertNotNull($stored->edge_provider_id);
        $this->assertSame(StorefrontDomain::VERIFICATION_VERIFIED, $stored->verification_status);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_authorized_admin_can_activate(): void
    {
        $auth = $this->registerTenant('edge-act-admin', 'owner@edge-act-admin.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-admin.example.com');
        $admin = $this->tokenForRole($auth['tenant_id'], 'admin', 'admin@edge-act-admin.test');

        $this->withToken($admin)
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();
    }

    /** @test */
    public function double_activation_is_idempotent_and_does_not_create_twice(): void
    {
        $auth = $this->registerTenant('edge-act-idemp', 'owner@edge-act-idemp.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-idemp.example.com');

        $first = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();
        $second = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertSame(1, $this->edge->provisionCalls);
        $this->assertGreaterThanOrEqual(1, $this->edge->fetchCalls);
        $this->assertSame($first->json('data.domain.edge.status'), $second->json('data.domain.edge.status'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(1, StorefrontDomain::query()->where('id', $seeded['domain']->id)->whereNotNull('edge_provider_id')->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function timeout_after_create_reconciles_by_hostname(): void
    {
        $this->edge->throwUnavailableAfterRecordingProvision = true;
        $auth = $this->registerTenant('edge-act-timeout', 'owner@edge-act-timeout.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-timeout.example.com');

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertSame(StorefrontDomain::EDGE_DNS_REQUIRED, $res->json('data.domain.edge.status'));
        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertNotNull($stored->edge_provider_id);
        $this->assertSame('fake-'.substr(hash('sha256', 'shop.edge-act-timeout.example.com'), 0, 32), $stored->edge_provider_id);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function create_conflict_reconciles_when_hostname_is_found(): void
    {
        $hostname = 'shop.edge-act-conflict.example.com';
        $this->edge->seedHostname($hostname);
        $this->edge->findMisses = 1;
        $this->edge->provisionFailure = 'conflict';

        $auth = $this->registerTenant('edge-act-conflict', 'owner@edge-act-conflict.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], $hostname);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertSame(StorefrontDomain::EDGE_DNS_REQUIRED, $res->json('data.domain.edge.status'));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['domain']->id)->edge_provider_id);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function unresolved_provider_conflict_returns_409(): void
    {
        $this->edge->provisionFailure = 'conflict';
        $auth = $this->registerTenant('edge-act-409', 'owner@edge-act-409.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-409.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(409);

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertSame(StorefrontDomain::EDGE_NONE, $stored->edge_status);
        $this->assertNull($stored->edge_provider_id);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function provider_failure_fails_closed_with_503(): void
    {
        $this->edge->provisionFailure = 'unavailable';
        $auth = $this->registerTenant('edge-act-503', 'owner@edge-act-503.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-503.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(503);

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertSame(StorefrontDomain::EDGE_NONE, $stored->edge_status);
        $this->assertNull($stored->edge_provider_id);
        $this->assertNotSame(StorefrontDomain::EDGE_READY, $stored->edge_status);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function missing_provider_configuration_returns_503(): void
    {
        $this->edge->misconfigured = true;
        $auth = $this->registerTenant('edge-act-misconf', 'owner@edge-act-misconf.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-misconf.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(503);
    }

    /** @test */
    public function unverified_custom_is_rejected(): void
    {
        $auth = $this->registerTenant('edge-act-unverified', 'owner@edge-act-unverified.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-unverified.example.com', [
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
            'verified_at' => null,
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(422);

        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function an_inactive_custom_domain_is_rejected(): void
    {
        $auth = $this->registerTenant('edge-act-inactive', 'owner@edge-act-inactive.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-inactive.example.com', [
            'is_active' => false,
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(422);

        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function awj_managed_domain_cannot_activate_edge(): void
    {
        $auth = $this->registerTenant('edge-act-awj', 'owner@edge-act-awj.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-awj.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['managed']->id))
            ->assertStatus(422);

        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function unsupported_apex_is_rejected(): void
    {
        $auth = $this->registerTenant('edge-act-apex', 'owner@edge-act-apex.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'edge-act-apex.com');

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(422);

        $this->assertStringContainsString('الجذري', (string) $res->json('message'));
        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function multi_label_public_suffix_apex_is_rejected(): void
    {
        $auth = $this->registerTenant('edge-act-psl', 'owner@edge-act-psl.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.co.uk');

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(422);

        $this->assertStringContainsString('الجذري', (string) $res->json('message'));
        $this->assertSame(0, $this->edge->provisionCalls);
        $this->assertSame(StorefrontDomain::EDGE_NONE, $seeded['domain']->fresh()->edge_status);
    }

    /** @test */
    public function awj_managed_namespace_is_rejected(): void
    {
        $auth = $this->registerTenant('edge-act-ns', 'owner@edge-act-ns.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.store.awjdev.test');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertStatus(422);
        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function client_cannot_supply_provider_or_edge_authority_fields(): void
    {
        $auth = $this->registerTenant('edge-act-authz', 'owner@edge-act-authz.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-authz.example.com');

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id), [
                'edge_status' => StorefrontDomain::EDGE_READY,
                'edge_provider_id' => 'client-supplied-id',
                'edge_dns_instructions' => ['records' => [['type' => 'A', 'name' => 'x', 'value' => '1.2.3.4']]],
                'tenant_id' => 'other',
                'storefront_id' => 'other',
            ])
            ->assertOk();

        $this->assertSame(StorefrontDomain::EDGE_DNS_REQUIRED, $res->json('data.domain.edge.status'));
        $this->assertNotSame('client-supplied-id', $res->json('data.domain.edge.status'));
        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertNotSame('client-supplied-id', $stored->edge_provider_id);
        $this->assertNotSame(StorefrontDomain::EDGE_READY, $stored->edge_status);
        $records = $stored->edge_dns_instructions['records'] ?? [];
        $this->assertNotSame('A', $records[0]['type'] ?? null);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function disconnect_after_activate_does_not_release_the_provider_in_edge_1(): void
    {
        $auth = $this->registerTenant('edge-act-dc', 'owner@edge-act-dc.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-dc.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->withToken($auth['token'])
            ->deleteJson('/api/commerce/workspace/storefronts/'.$seeded['storefront']->id.'/domains/'.$seeded['domain']->id)
            ->assertOk();

        $this->assertSame(0, $this->edge->releaseCalls);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNull(StorefrontDomain::query()->find($seeded['domain']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_cross_tenant_domain_returns_404(): void
    {
        $a = $this->registerTenant('edge-act-idor-a', 'owner@edge-act-idor-a.test');
        $b = $this->registerTenant('edge-act-idor-b', 'owner@edge-act-idor-b.test');
        $seededB = $this->seedVerifiedCustom($b['tenant_id'], 'shop.edge-act-idor-b.example.com');

        $this->withToken($a['token'])
            ->postJson($this->path($seededB['storefront']->id, $seededB['domain']->id))
            ->assertNotFound();
        $this->assertSame(0, $this->edge->provisionCalls);
    }

    /** @test */
    public function a_domain_belonging_to_another_storefront_returns_404(): void
    {
        $auth = $this->registerTenant('edge-act-other-sf', 'owner@edge-act-other-sf.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-other-sf.example.com');

        app(TenantContext::class)->set($auth['tenant_id']);
        $otherChannel = SalesChannel::create([
            'slug' => 'web-2', 'name' => 'ويب 2', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $otherStorefront = Storefront::create([
            'slug' => 'second', 'name' => 'متجر آخر', 'sales_channel_id' => $otherChannel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson($this->path($otherStorefront->id, $seeded['domain']->id))
            ->assertNotFound();
    }

    /** @test */
    public function an_unknown_domain_id_returns_404(): void
    {
        $auth = $this->registerTenant('edge-act-unknown', 'owner@edge-act-unknown.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-unknown.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, '00000000-0000-0000-0000-000000000000'))
            ->assertNotFound();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('edge-act-staff', 'owner@edge-act-staff.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-staff.example.com');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@edge-act-staff.test');

        $this->withToken($staff)
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertForbidden();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('edge-act-ss', 'owner@edge-act-ss.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-ss.example.com');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@edge-act-ss.test');

        $this->withToken($ss)
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('edge-act-guest', 'owner@edge-act-guest.test');
        $seeded = $this->seedVerifiedCustom($auth['tenant_id'], 'shop.edge-act-guest.example.com');

        $this->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertUnauthorized();
    }
}
