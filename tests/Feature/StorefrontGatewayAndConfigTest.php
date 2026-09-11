<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COM-7-P2B — Next.js↔Laravel forwarded-host gateway + storefront config
 * ═══════════════════════════════════════════════════════════════
 *  `ResolveStorefrontDomain` (COM-7-P2A) resolves Tenant/Storefront/Channel
 *  from `$request->getHost()`. In production the only caller of `store/v1`
 *  is the Next.js storefront server, so the literal connection Host Laravel
 *  sees is always Laravel's own domain, never the visitor's. These tests
 *  cover the secret-gated `X-Storefront-Forwarded-Host` alternate input this
 *  PR adds, and the new minimal `GET storefront` config endpoint.
 *
 *  تشغيل: php artisan test --filter=StorefrontGatewayAndConfigTest
 */
class StorefrontGatewayAndConfigTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront, domain: StorefrontDomain} */
    private function seedDomainStore(string $hostname, array $storefrontOverrides = []): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$hostname}", 'slug' => 'gw-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        $storefront = Storefront::create(array_merge([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ], $storefrontOverrides));

        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        app(TenantContext::class)->forget();

        return compact('tenant', 'channel', 'storefront', 'domain');
    }

    // ── Forwarded-host gateway ───────────────────────────────────────────

    /** @test */
    public function a_correctly_signed_forwarded_host_header_resolves_the_visitor_domain(): void
    {
        config(['storefront.gateway_secret' => 'test-shared-secret']);
        $this->seedDomainStore('shop.example.com');

        // الاتصال الفعلي يستهدف نطاقاً غير مسجَّل إطلاقاً (يحاكي نطاق Laravel
        // الحقيقي في الإنتاج) — النجاح هنا يثبت أن الحسم استخدم الترويسة
        // المُوجَّهة لا Host الاتصال نفسه.
        $res = $this->withHeaders([
            'X-Storefront-Forwarded-Host' => 'shop.example.com',
            'X-Storefront-Gateway-Secret' => 'test-shared-secret',
        ])->getJson('http://laravel-internal.test/store/v1/categories');

        $res->assertOk();
    }

    /** @test */
    public function an_incorrect_gateway_secret_is_ignored_and_falls_back_to_the_connection_host(): void
    {
        config(['storefront.gateway_secret' => 'test-shared-secret']);
        $this->seedDomainStore('shop2.example.com');

        $res = $this->withHeaders([
            'X-Storefront-Forwarded-Host' => 'shop2.example.com',
            'X-Storefront-Gateway-Secret' => 'guessed-wrong-secret',
        ])->getJson('http://laravel-internal.test/store/v1/categories');

        // بلا السرّ الصحيح، الترويسة تُتجاهل كلياً — الحسم يقع على
        // laravel-internal.test نفسه، غير المسجَّل، ففشلٌ مغلق.
        $res->assertStatus(404);
    }

    /** @test */
    public function an_unconfigured_gateway_secret_disables_the_forwarded_host_mechanism_entirely(): void
    {
        config(['storefront.gateway_secret' => null]);
        $this->seedDomainStore('shop3.example.com');

        $res = $this->withHeaders([
            'X-Storefront-Forwarded-Host' => 'shop3.example.com',
            'X-Storefront-Gateway-Secret' => 'anything',
        ])->getJson('http://laravel-internal.test/store/v1/categories');

        $res->assertStatus(404);
    }

    /** @test */
    public function a_missing_forwarded_host_header_still_resolves_normally_from_the_connection_host(): void
    {
        config(['storefront.gateway_secret' => 'test-shared-secret']);
        $this->seedDomainStore('shop4.example.com');

        // لا ترويسة توجيه إطلاقاً — نفس سلوك P2A الأصلي، بلا أي تأثير من
        // تفعيل بوابة الثقة على المسار العادي.
        $res = $this->getJson('http://shop4.example.com/store/v1/categories');

        $res->assertOk();
    }

    /** @test */
    public function a_forwarded_host_alone_without_the_secret_header_at_all_is_ignored(): void
    {
        config(['storefront.gateway_secret' => 'test-shared-secret']);
        $this->seedDomainStore('shop5.example.com');

        $res = $this->withHeaders([
            'X-Storefront-Forwarded-Host' => 'shop5.example.com',
        ])->getJson('http://laravel-internal.test/store/v1/categories');

        $res->assertStatus(404);
    }

    // ── Storefront config endpoint ───────────────────────────────────────

    /** @test */
    public function storefront_config_exposes_the_resolved_storefronts_default_locale(): void
    {
        ['domain' => $domain] = $this->seedDomainStore('locale-host.example.com', ['default_locale' => 'en']);

        $res = $this->getJson("http://{$domain->hostname}/store/v1/storefront")->assertOk();

        $this->assertSame('en', $res->json('data.default_locale'));
    }

    /** @test */
    public function storefront_config_defaults_to_ar_when_the_storefront_does_not_override_it(): void
    {
        ['domain' => $domain] = $this->seedDomainStore('locale-host-default.example.com');

        $res = $this->getJson("http://{$domain->hostname}/store/v1/storefront")->assertOk();

        $this->assertSame('ar', $res->json('data.default_locale'));
    }

    /** @test */
    public function the_legacy_path_returns_a_null_default_locale_since_it_resolves_no_storefront(): void
    {
        $tenant = Tenant::create([
            'name' => 'متجر متوارَث', 'slug' => 'legacy-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $res = $this->getJson("/store/v1/{$tenant->slug}/storefront")->assertOk();

        $this->assertNull($res->json('data.default_locale'));
    }

    /** @test */
    public function config_endpoint_never_leaks_a_cross_tenant_storefront_via_the_forwarded_host_gateway(): void
    {
        config(['storefront.gateway_secret' => 'test-shared-secret']);
        $this->seedDomainStore('tenant-a.example.com', ['default_locale' => 'en']);
        $this->seedDomainStore('tenant-b.example.com', ['default_locale' => 'ar']);

        $res = $this->withHeaders([
            'X-Storefront-Forwarded-Host' => 'tenant-a.example.com',
            'X-Storefront-Gateway-Secret' => 'test-shared-secret',
        ])->getJson('http://laravel-internal.test/store/v1/storefront');

        $res->assertOk();
        $this->assertSame('en', $res->json('data.default_locale'));
    }
}
