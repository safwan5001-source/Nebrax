<?php

namespace Tests\Feature;

use App\Http\Middleware\ResolveCommerceLocale;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\CommerceLocale;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COM-MOBILE-I18N-1 (ADR-12) — shared Commerce API locale resolution
 * ═══════════════════════════════════════════════════════════════
 *  Three layers: (1) `CommerceLocale::resolve()` — pure `Accept-Language`
 *  parsing logic, exhaustively unit-tested; (2) `ResolveCommerceLocale`
 *  middleware in isolation — proves it resolves, applies, and restores
 *  `app()->getLocale()` around the request; (3) real HTTP requests through
 *  `/commerce/v1` and `/store/v1`, asserting the standard `Content-Language`
 *  response header this middleware adds, plus a route-registration check
 *  proving the middleware is actually attached to both surfaces.
 *
 *  تشغيل: php artisan test --filter=CommerceLocaleResolutionTest
 */
class CommerceLocaleResolutionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    // ── 1. CommerceLocale::resolve() — pure parsing logic ──────────────────

    /** @test */
    public function a_missing_or_empty_header_resolves_to_the_default(): void
    {
        $this->assertSame('ar', CommerceLocale::resolve(null));
        $this->assertSame('ar', CommerceLocale::resolve(''));
        $this->assertSame('ar', CommerceLocale::resolve('   '));
    }

    /** @test */
    public function a_plain_supported_tag_resolves_directly(): void
    {
        $this->assertSame('en', CommerceLocale::resolve('en'));
        $this->assertSame('ar', CommerceLocale::resolve('ar'));
    }

    /** @test */
    public function a_regional_subtag_matches_its_primary_language(): void
    {
        $this->assertSame('en', CommerceLocale::resolve('en-US'));
        $this->assertSame('ar', CommerceLocale::resolve('ar-SA'));
    }

    /** @test */
    public function quality_values_are_honored_highest_first(): void
    {
        $this->assertSame('en', CommerceLocale::resolve('ar;q=0.5,en;q=0.9'));
        $this->assertSame('ar', CommerceLocale::resolve('en;q=0.3,ar;q=0.8'));
    }

    /** @test */
    public function an_unsupported_preference_falls_back_to_the_default_when_no_supported_tag_is_present(): void
    {
        $this->assertSame('ar', CommerceLocale::resolve('fr'));
        $this->assertSame('ar', CommerceLocale::resolve('fr-FR,de;q=0.8'));
    }

    /** @test */
    public function an_unsupported_preference_is_skipped_in_favor_of_a_supported_one_further_down_the_list(): void
    {
        $this->assertSame('en', CommerceLocale::resolve('fr,en;q=0.5'));
    }

    /** @test */
    public function a_wildcard_is_never_itself_treated_as_a_match(): void
    {
        $this->assertSame('ar', CommerceLocale::resolve('*'));
        $this->assertSame('en', CommerceLocale::resolve('*;q=0.9,en;q=0.8'));
    }

    /** @test */
    public function a_malformed_quality_value_does_not_throw_and_falls_back_safely(): void
    {
        $this->assertSame('ar', CommerceLocale::resolve('en;q=not-a-number,ar'));
    }

    /** @test */
    public function matching_is_case_insensitive(): void
    {
        $this->assertSame('en', CommerceLocale::resolve('EN-US'));
    }

    // ── 2. ResolveCommerceLocale middleware in isolation ────────────────────

    /** @test */
    public function the_middleware_resolves_locale_for_next_and_restores_it_afterward(): void
    {
        app()->setLocale('fr');

        $middleware = new ResolveCommerceLocale();
        $request = Request::create('/commerce/v1/storefront', 'GET', server: ['HTTP_ACCEPT_LANGUAGE' => 'en']);

        $observedDuringRequest = null;
        $response = $middleware->handle($request, function (Request $req) use (&$observedDuringRequest): Response {
            $observedDuringRequest = app()->getLocale();

            return new Response('ok');
        });

        $this->assertSame('en', $observedDuringRequest);
        $this->assertSame('fr', app()->getLocale());
        $this->assertSame('en', $response->headers->get('Content-Language'));
    }

    /** @test */
    public function the_middleware_defaults_to_arabic_when_no_header_is_present(): void
    {
        $middleware = new ResolveCommerceLocale();
        // Symfony's Request::create() hardcodes its own 'en-us,en;q=0.5'
        // Accept-Language default for any server key it isn't given
        // explicitly (simulating "a typical browser") — the real absence of
        // the header this test means to simulate requires overriding it to
        // an explicitly empty value, not merely omitting the key.
        $request = Request::create('/commerce/v1/storefront', 'GET', server: ['HTTP_ACCEPT_LANGUAGE' => '']);

        $response = $middleware->handle($request, fn (Request $req): Response => new Response('ok'));

        $this->assertSame('ar', $response->headers->get('Content-Language'));
    }

    // ── 3. Route wiring — the middleware is actually attached ──────────────

    /** @test */
    public function commerce_v1_routes_carry_the_locale_middleware(): void
    {
        $route = collect(Route::getRoutes())->first(fn ($r) => str_starts_with($r->uri(), 'commerce/v1/storefront'));

        $this->assertNotNull($route, 'commerce/v1/storefront route not found.');
        $this->assertContains(ResolveCommerceLocale::class, $route->gatherMiddleware());
    }

    /** @test */
    public function store_v1_routes_carry_the_locale_middleware(): void
    {
        $route = collect(Route::getRoutes())->first(fn ($r) => str_starts_with($r->uri(), 'store/v1/storefront'));

        $this->assertNotNull($route, 'store/v1/storefront route not found.');
        $this->assertContains(ResolveCommerceLocale::class, $route->gatherMiddleware());
    }

    // ── 4. Real HTTP requests through /commerce/v1 and /store/v1 ────────────

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function seedMobileStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        $client = $this->service()->createClient($tenant, 'mobile-app', true);
        $key = $this->service()->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken];
    }

    /** @test */
    public function a_commerce_v1_request_echoes_the_resolved_locale_in_content_language(): void
    {
        $store = $this->seedMobileStore('locale-commerce');

        $this->withHeaders(['Authorization' => 'Bearer '.$store['token'], 'Accept-Language' => 'en'])
            ->getJson('/commerce/v1/storefront')
            ->assertOk()
            ->assertHeader('Content-Language', 'en');

        // withHeaders() accumulates on the test instance across requests —
        // flush before the next call or the prior Accept-Language leaks in.
        // Symfony's Request::create() also fills its own 'en-us,en;q=0.5'
        // default for any Accept-Language key not explicitly overridden, so
        // simulating a genuinely absent header requires forcing it empty,
        // not merely omitting it.
        $this->flushHeaders();

        $this->withHeaders(['Authorization' => 'Bearer '.$store['token'], 'Accept-Language' => ''])
            ->getJson('/commerce/v1/storefront')
            ->assertOk()
            ->assertHeader('Content-Language', 'ar');
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront} */
    private function seedDomainStore(string $hostname): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$hostname}", 'slug' => 'store-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);

        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        app(TenantContext::class)->forget();

        return compact('tenant', 'channel', 'storefront');
    }

    /** @test */
    public function a_store_v1_request_echoes_the_resolved_locale_in_content_language(): void
    {
        $store = $this->seedDomainStore('locale-store.example.com');

        $this->getJson('http://locale-store.example.com/store/v1/storefront', ['Accept-Language' => 'en'])
            ->assertOk()
            ->assertHeader('Content-Language', 'en');

        // Symfony's Request::create() fills its own 'en-us,en;q=0.5' default
        // for any Accept-Language key the test doesn't explicitly override —
        // omitting the header here would not simulate a real absent header;
        // it must be forced empty to prove the ar-default fallback.
        $this->getJson('http://locale-store.example.com/store/v1/storefront', ['Accept-Language' => ''])
            ->assertOk()
            ->assertHeader('Content-Language', 'ar');
    }
}
