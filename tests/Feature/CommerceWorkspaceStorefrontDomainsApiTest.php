<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STORE-ADMIN-ADOPT-1B-2 — `GET /api/commerce/workspace/storefronts/{id}/domains`:
 * رؤية نطاقات متجر قائم (قراءة فقط)، عزل المستأجر (IDOR: 404 لا 403)، RBAC
 * (`commerce.manage`)، وعدم وجود أي أثر كتابي.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceStorefrontDomainsApiTest
 */
class CommerceWorkspaceStorefrontDomainsApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function path(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/domains';
    }

    /**
     * @return array{channel: SalesChannel, storefront: Storefront, domains: list<StorefrontDomain>}
     */
    private function seedWebStorefront(string $tenantId, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);

        $channelSlug = $overrides['channel_slug'] ?? 'web';
        $channel = SalesChannel::query()->where('slug', $channelSlug)->first()
            ?? SalesChannel::create([
                'slug' => $channelSlug,
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => true,
            ]);

        $storefront = Storefront::create([
            'slug' => $overrides['slug'] ?? 'main',
            'name' => $overrides['name'] ?? 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        $domains = [];
        foreach ($overrides['domains'] ?? [] as $domainOverrides) {
            $domains[] = StorefrontDomain::create(array_merge([
                'storefront_id' => $storefront->id,
                'type' => StorefrontDomain::TYPE_CUSTOM,
                'is_primary' => false,
                'is_active' => true,
                'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            ], $domainOverrides));
        }

        app(TenantContext::class)->forget();

        return ['channel' => $channel, 'storefront' => $storefront, 'domains' => $domains];
    }

    /** @test */
    public function an_authorized_owner_can_list_their_own_storefronts_domains(): void
    {
        $auth = $this->registerTenant('domains-owner', 'owner@domains-owner.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], [
            'domains' => [
                [
                    'hostname' => 'domains-owner.awj-commerce.test',
                    'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
                    'is_primary' => true,
                ],
            ],
        ]);

        $res = $this->withToken($auth['token'])->getJson($this->path($seeded['storefront']->id))->assertOk();

        $this->assertCount(1, $res->json('data.domains'));
        $row = $res->json('data.domains.0');
        // STORE-ADMIN-ADOPT-1B-3A: `verification` مضافٌ إضافياً (القرار §32)
        // بعد الحقول الستة القائمة — بلا حذف/إعادة تسمية لأيٍّ منها.
        $this->assertSame(
            ['id', 'hostname', 'type', 'is_primary', 'is_active', 'verification_status', 'verification'],
            array_keys($row)
        );
        $this->assertSame('domains-owner.awj-commerce.test', $row['hostname']);
        $this->assertSame(StorefrontDomain::TYPE_AWJ_SUBDOMAIN, $row['type']);
        $this->assertTrue($row['is_primary']);
        $this->assertTrue($row['is_active']);
        $this->assertSame(StorefrontDomain::VERIFICATION_VERIFIED, $row['verification_status']);
        // نطاق مُدار من أَوْج — لا يحمل verification_token، فـ`verification` يبقى null.
        $this->assertNull($row['verification']);
    }

    /** @test */
    public function a_freshly_provisioned_storefront_returns_exactly_one_awj_managed_domain(): void
    {
        $auth = $this->registerTenant('freshly-provisioned', 'owner@freshly-provisioned.test');

        $provision = $this->withToken($auth['token'])->postJson('/api/commerce/workspace/storefronts')->assertCreated();
        $storefrontId = $provision->json('data.store.id');

        $res = $this->withToken($auth['token'])->getJson($this->path($storefrontId))->assertOk();

        $this->assertCount(1, $res->json('data.domains'));
        $this->assertSame(StorefrontDomain::TYPE_AWJ_SUBDOMAIN, $res->json('data.domains.0.type'));
    }

    /** @test */
    public function a_custom_domain_is_returned_as_custom_with_no_mutation(): void
    {
        $auth = $this->registerTenant('custom-domain', 'owner@custom-domain.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], [
            'domains' => [
                [
                    'hostname' => 'awj-sub.awj-commerce.test',
                    'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
                    'is_primary' => true,
                ],
                [
                    'hostname' => 'shop.custom-domain-example.com',
                    'type' => StorefrontDomain::TYPE_CUSTOM,
                    'is_primary' => false,
                    'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
                ],
            ],
        ]);

        $res = $this->withToken($auth['token'])->getJson($this->path($seeded['storefront']->id))->assertOk();

        $rows = collect($res->json('data.domains'));
        $this->assertCount(2, $rows);
        $custom = $rows->firstWhere('hostname', 'shop.custom-domain-example.com');
        $this->assertNotNull($custom);
        $this->assertSame(StorefrontDomain::TYPE_CUSTOM, $custom['type']);
        $this->assertSame(StorefrontDomain::VERIFICATION_PENDING, $custom['verification_status']);
        $this->assertFalse($custom['is_primary']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $fresh = StorefrontDomain::query()->where('hostname', 'shop.custom-domain-example.com')->first();
        $this->assertSame(StorefrontDomain::VERIFICATION_PENDING, $fresh->verification_status);
        $this->assertFalse((bool) $fresh->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_cross_tenant_storefront_id_returns_404_and_leaks_nothing(): void
    {
        $a = $this->registerTenant('domains-idor-a', 'owner@domains-idor-a.test');
        $b = $this->registerTenant('domains-idor-b', 'owner@domains-idor-b.test');
        $seededB = $this->seedWebStorefront($b['tenant_id'], [
            'domains' => [
                ['hostname' => 'secret-b.example.com', 'is_primary' => true],
            ],
        ]);

        $res = $this->withToken($a['token'])->getJson($this->path($seededB['storefront']->id));

        $res->assertNotFound();
        $this->assertStringNotContainsString('secret-b.example.com', $res->getContent());
    }

    /** @test */
    public function an_unknown_storefront_id_returns_404(): void
    {
        $auth = $this->registerTenant('domains-missing', 'owner@domains-missing.test');

        $this->withToken($auth['token'])
            ->getJson($this->path('00000000-0000-0000-0000-000000000000'))
            ->assertNotFound();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('domains-staff', 'owner@domains-staff.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@domains-staff.test');

        $this->withToken($staff)->getJson($this->path($seeded['storefront']->id))->assertForbidden();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('domains-ss', 'owner@domains-ss.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@domains-ss.test');

        $this->withToken($ss)->getJson($this->path($seeded['storefront']->id))->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('domains-guest', 'owner@domains-guest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->getJson($this->path($seeded['storefront']->id))->assertUnauthorized();
    }

    /** @test */
    public function tenant_a_cannot_observe_tenant_bs_domain_hostname_or_status(): void
    {
        $a = $this->registerTenant('observe-a', 'owner@observe-a.test');
        $b = $this->registerTenant('observe-b', 'owner@observe-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id'], [
            'domains' => [['hostname' => 'visible-a.example.com', 'is_primary' => true]],
        ]);
        $this->seedWebStorefront($b['tenant_id'], [
            'domains' => [['hostname' => 'hidden-b.example.com', 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_FAILED]],
        ]);

        $res = $this->withToken($a['token'])->getJson($this->path($seededA['storefront']->id))->assertOk();

        $this->assertCount(1, $res->json('data.domains'));
        $this->assertStringNotContainsString('hidden-b.example.com', $res->getContent());
        $this->assertStringNotContainsString($b['tenant_id'], $res->getContent());
    }

    /** @test */
    public function a_storefront_with_zero_domain_rows_returns_an_empty_array_not_a_404(): void
    {
        $auth = $this->registerTenant('domains-empty', 'owner@domains-empty.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])->getJson($this->path($seeded['storefront']->id))
            ->assertOk()
            ->assertJsonPath('data.domains', []);
    }

    /** @test */
    public function the_endpoint_performs_no_mutation_on_the_domain_rows(): void
    {
        $auth = $this->registerTenant('domains-no-mutation', 'owner@domains-no-mutation.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], [
            'domains' => [
                [
                    'hostname' => 'no-mutation.example.com',
                    'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
                    'is_primary' => true,
                    'is_active' => true,
                    'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
                ],
            ],
        ]);
        $before = $seeded['domains'][0]->only(['hostname', 'type', 'is_primary', 'is_active', 'verification_status']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $beforeCount = StorefrontDomain::query()->count();
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->getJson($this->path($seeded['storefront']->id))->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $after = StorefrontDomain::query()->find($seeded['domains'][0]->id)
            ->only(['hostname', 'type', 'is_primary', 'is_active', 'verification_status']);
        $afterCount = StorefrontDomain::query()->count();
        app(TenantContext::class)->forget();

        $this->assertSame($before, $after);
        $this->assertSame($beforeCount, $afterCount);
    }
}
