<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\StorefrontDomainVerificationService;
use App\Support\Dns\DnsOperationalException;
use App\Support\Dns\DnsTxtResolver;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STORE-ADMIN-ADOPT-1B-3A — `POST /api/commerce/workspace/storefronts/{id}/domains/{domainId}/verify`:
 * تحقّق DNS TXT فعلي (عبر تنفيذ وهمي حتمي، بلا إنترنت حقيقي)، عزل المستأجر/
 * الملكية، RBAC، idempotency، ودلالات الفشل (غياب/عدم تطابق مقابل خطأ تشغيلي).
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceVerifyCustomDomainApiTest
 */
class CommerceWorkspaceVerifyCustomDomainApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function path(string $storefrontId, string $domainId): string
    {
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/domains/'.$domainId.'/verify';
    }

    private function bindFakeResolver(?array $records = null, bool $fail = false): void
    {
        $this->app->bind(DnsTxtResolver::class, function () use ($records, $fail) {
            return new class($records, $fail) implements DnsTxtResolver {
                public function __construct(private ?array $records, private bool $fail) {}

                public function lookupTxt(string $recordName): array
                {
                    if ($this->fail) {
                        throw new DnsOperationalException('DNS operational failure (fake).');
                    }

                    return $this->records ?? [];
                }
            };
        });
    }

    /**
     * @return array{storefront: Storefront, domain: StorefrontDomain, token: string}
     */
    private function seedCustomDomain(string $tenantId, string $hostname, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $token = $overrides['verification_token'] ?? StorefrontDomainVerificationService::generateToken();
        $domain = StorefrontDomain::create(array_merge([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
            'verification_token' => $token,
        ], $overrides));
        app(TenantContext::class)->forget();

        return ['storefront' => $storefront, 'domain' => $domain, 'token' => $token];
    }

    /** @test */
    public function exact_dns_proof_verifies_the_domain_and_sets_verified_at(): void
    {
        $auth = $this->registerTenant('verify-owner', 'owner@verify-owner.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-success.example.com');
        $this->bindFakeResolver([StorefrontDomainVerificationService::expectedValueFor($seeded['token'])]);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $row = $res->json('data.domain');
        $this->assertSame(StorefrontDomain::VERIFICATION_VERIFIED, $row['verification_status']);
        $this->assertNotNull($row['verification']['verified_at']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertSame(StorefrontDomain::VERIFICATION_VERIFIED, $stored->verification_status);
        $this->assertNotNull($stored->verified_at);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_missing_txt_record_never_verifies(): void
    {
        $auth = $this->registerTenant('verify-missing', 'owner@verify-missing.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-missing.example.com');
        $this->bindFakeResolver([]);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertNotSame(StorefrontDomain::VERIFICATION_VERIFIED, $res->json('data.domain.verification_status'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertNotSame(StorefrontDomain::VERIFICATION_VERIFIED, $stored->verification_status);
        $this->assertNull($stored->verified_at);
        // Token untouched — retry without regeneration remains possible.
        $this->assertSame($seeded['token'], $stored->verification_token);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_mismatched_txt_record_never_verifies(): void
    {
        $auth = $this->registerTenant('verify-mismatch', 'owner@verify-mismatch.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-mismatch.example.com');
        $this->bindFakeResolver(['awj-domain-verification=totally-wrong-token']);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertNotSame(StorefrontDomain::VERIFICATION_VERIFIED, $stored->verification_status);
        $this->assertNull($stored->verified_at);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_operational_dns_failure_never_verifies_and_returns_a_safe_retryable_error(): void
    {
        $auth = $this->registerTenant('verify-operational', 'owner@verify-operational.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-operational.example.com');
        $this->bindFakeResolver(fail: true);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id));

        $res->assertStatus(503);

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertSame(StorefrontDomain::VERIFICATION_PENDING, $stored->verification_status);
        $this->assertNull($stored->verified_at);
        $this->assertSame($seeded['token'], $stored->verification_token);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_cross_tenant_domain_returns_404(): void
    {
        $a = $this->registerTenant('verify-idor-a', 'owner@verify-idor-a.test');
        $b = $this->registerTenant('verify-idor-b', 'owner@verify-idor-b.test');
        $seededB = $this->seedCustomDomain($b['tenant_id'], 'verify-idor-b.example.com');
        $this->bindFakeResolver([StorefrontDomainVerificationService::expectedValueFor($seededB['token'])]);

        $this->withToken($a['token'])
            ->postJson($this->path($seededB['storefront']->id, $seededB['domain']->id))
            ->assertNotFound();

        app(TenantContext::class)->set($b['tenant_id']);
        $stored = StorefrontDomain::query()->find($seededB['domain']->id);
        $this->assertSame(StorefrontDomain::VERIFICATION_PENDING, $stored->verification_status);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_domain_belonging_to_another_storefront_returns_404(): void
    {
        $auth = $this->registerTenant('verify-other-storefront', 'owner@verify-other-storefront.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-other-storefront.example.com');

        app(TenantContext::class)->set($auth['tenant_id']);
        $otherChannel = SalesChannel::create([
            'slug' => 'web-2', 'name' => 'ويب 2', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $otherStorefront = Storefront::create([
            'slug' => 'second', 'name' => 'متجر آخر', 'sales_channel_id' => $otherChannel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $this->bindFakeResolver([StorefrontDomainVerificationService::expectedValueFor($seeded['token'])]);

        $this->withToken($auth['token'])
            ->postJson($this->path($otherStorefront->id, $seeded['domain']->id))
            ->assertNotFound();
    }

    /** @test */
    public function an_unknown_domain_id_returns_404(): void
    {
        $auth = $this->registerTenant('verify-unknown', 'owner@verify-unknown.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-unknown.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, '00000000-0000-0000-0000-000000000000'))
            ->assertNotFound();
    }

    /** @test */
    public function an_awj_managed_domain_cannot_use_the_custom_verification_flow(): void
    {
        $auth = $this->registerTenant('verify-managed', 'owner@verify-managed.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $managedDomain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'verify-managed.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson($this->path($storefront->id, $managedDomain->id))
            ->assertStatus(422);
    }

    /** @test */
    public function client_cannot_force_a_verification_result(): void
    {
        $auth = $this->registerTenant('verify-force', 'owner@verify-force.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-force.example.com');
        $this->bindFakeResolver([]); // Real DNS proof absent.

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id), [
                'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
                'verified' => true,
                'verified_at' => now()->toIso8601String(),
            ])
            ->assertOk();

        $this->assertNotSame(StorefrontDomain::VERIFICATION_VERIFIED, $res->json('data.domain.verification_status'));
    }

    /** @test */
    public function repeated_verify_now_on_an_already_verified_domain_is_idempotent_and_preserves_verified_at(): void
    {
        $auth = $this->registerTenant('verify-idempotent', 'owner@verify-idempotent.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-idempotent.example.com');
        $this->bindFakeResolver([StorefrontDomainVerificationService::expectedValueFor($seeded['token'])]);

        $first = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();
        $firstVerifiedAt = $first->json('data.domain.verification.verified_at');
        $this->assertNotNull($firstVerifiedAt);

        // Second call: even if DNS were to go missing now, an already-verified
        // domain must not be downgraded, must not re-query DNS, and verified_at
        // must not move.
        $this->bindFakeResolver([]);

        $second = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertOk();

        $this->assertSame(StorefrontDomain::VERIFICATION_VERIFIED, $second->json('data.domain.verification_status'));
        $this->assertSame($firstVerifiedAt, $second->json('data.domain.verification.verified_at'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->find($seeded['domain']->id);
        $this->assertSame($seeded['token'], $stored->verification_token);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('verify-staff', 'owner@verify-staff.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-staff.example.com');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@verify-staff.test');

        $this->withToken($staff)
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertForbidden();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('verify-ss', 'owner@verify-ss.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-ss.example.com');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@verify-ss.test');

        $this->withToken($ss)
            ->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('verify-guest', 'owner@verify-guest.test');
        $seeded = $this->seedCustomDomain($auth['tenant_id'], 'verify-guest.example.com');

        $this->postJson($this->path($seeded['storefront']->id, $seeded['domain']->id))
            ->assertUnauthorized();
    }
}
