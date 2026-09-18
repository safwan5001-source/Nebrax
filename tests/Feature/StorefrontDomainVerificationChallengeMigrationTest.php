<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\StorefrontDomainVerificationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STORE-ADMIN-ADOPT-1B-3A — ترحيل `verification_token`/`verified_at`:
 * توافق رجعي مع صفوف تاريخية (خصوصاً `awj_subdomain` مُتحقَّقة بلا token)،
 * وعدم تسريب `verification_token` خارج استجابة Commerce Workspace.
 *
 * تشغيل: php artisan test --filter=StorefrontDomainVerificationChallengeMigrationTest
 */
class StorefrontDomainVerificationChallengeMigrationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedStorefront(string $tenantId): Storefront
    {
        app(TenantContext::class)->set($tenantId);
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
    public function a_historical_verified_awj_managed_domain_remains_valid_with_null_challenge(): void
    {
        $auth = $this->registerTenant('migration-historical-awj', 'owner@migration-historical-awj.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        // مطابقٌ حرفياً لِما ينتجه `RegisterStorefrontDomainCommand`/
        // `StorefrontProvisioningService` القائمَين — بلا verification_token
        // أو verified_at إطلاقاً.
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'historical.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $this->assertNull($domain->verification_token);
        $this->assertNull($domain->verified_at);
        $this->assertTrue($domain->isVerified());

        $domain->refresh();
        $this->assertNull($domain->verification_token);
        $this->assertNull($domain->verified_at);
        $this->assertTrue($domain->isVerified());
    }

    /** @test */
    public function a_new_custom_domain_supports_a_pending_challenge_before_verification(): void
    {
        $auth = $this->registerTenant('migration-new-custom', 'owner@migration-new-custom.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $token = StorefrontDomainVerificationService::generateToken();
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'new-custom.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
            'verification_token' => $token,
        ]);
        app(TenantContext::class)->forget();

        $this->assertSame($token, $domain->verification_token);
        $this->assertNull($domain->verified_at);
        $this->assertFalse($domain->isVerified());
    }

    /** @test */
    public function hostname_uniqueness_is_unaffected_by_the_new_columns(): void
    {
        $auth = $this->registerTenant('migration-uniqueness', 'owner@migration-uniqueness.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'unique-check.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
            'verification_token' => StorefrontDomainVerificationService::generateToken(),
        ]);

        $this->expectException(\Throwable::class);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'unique-check.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
            'verification_token' => StorefrontDomainVerificationService::generateToken(),
        ]);
    }

    /** @test */
    public function the_commerce_workspace_domains_list_never_leaks_the_verification_token_field(): void
    {
        $auth = $this->registerTenant('migration-no-leak', 'owner@migration-no-leak.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'no-leak.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
            'verification_token' => 'super-secret-looking-token-should-not-leak-raw-key',
        ]);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson('/api/commerce/workspace/storefronts/'.$storefront->id.'/domains')
            ->assertOk();

        // The token appears legitimately embedded inside `record_value`
        // (`awj-domain-verification=<token>`) — that is the intended DNS
        // instructions surface. What must never appear is a raw
        // `verification_token` JSON key on the row.
        $row = collect($res->json('data.domains'))->firstWhere('hostname', 'no-leak.example.com');
        $this->assertArrayNotHasKey('verification_token', $row);
    }
}
