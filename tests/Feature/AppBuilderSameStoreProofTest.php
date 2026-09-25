<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\AppBuilder\CapabilityManifest;
use App\Services\AppBuilder\CompatibilityResolver;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  APP-BUILDER-20 — Same-Store integrated proof
 * ═══════════════════════════════════════════════════════════════
 *
 * ADR-01's own amendment defines this task's scope precisely: the proof
 * must demonstrate that Storefront Web (`store/v1`) and the Mobile App
 * (`commerce/v1`, the surface an App-Builder-published `binding` resolves
 * against) consume the **same Commerce Core data/business rules** — shared
 * models, shared price/availability resolvers, shared tenant/channel
 * boundary. It does **not** require the Storefront Web application itself
 * to be feature-complete (the still-mid-migration Spree-based `storefront/`
 * is irrelevant here — `store/v1` is the real, already-live read API it
 * calls).
 *
 * This test proves it end-to-end with real HTTP round trips, no mocking:
 * one product, published to both a `web` and a `mobile` `SalesChannel`
 * under the same tenant; an App Builder Experience authored with a real
 * `ProductList` → `commerce.products` binding, published through the real
 * draft → validate → publish pipeline; fetched back through the exact
 * `GET commerce/v1/experience` endpoint `mobile/lib/startup/
 * experience_fetcher.dart` calls in production, and re-resolved through
 * the same `CompatibilityResolver`/`CapabilityManifest::current()` the
 * shipped mobile runtime uses — proving the full publish → fetch →
 * compatibility pipeline works for a real HTTP round trip, not only a
 * fake-transport widget test (`mobile/test/app/vertical_slice_test.dart`).
 * Finally, `commerce/v1/products` and `store/v1/products` are compared
 * directly for the same product: identical price/name/stock, and — since
 * `CommerceProductController` and `StorefrontProductController` both
 * format through `StorefrontProductResource` and resolve through the same
 * `CommercePriceResolver`/`AvailableToSellService` — a live price change
 * with **no republish** is reflected on both channels immediately (the
 * Update/Release Matrix's Category A, evidence doc §4).
 *
 * **Formerly deferred, now resolved (AWJ Runtime Boot contract,
 * `AWJ-RUNTIME-BOOT-1`)**: this proof itself still only exercises the fetch
 * → compatibility pipeline directly, not `AwjRuntimeShell`'s widget tree —
 * but the "no Experience published yet" fallback-UX decision this doc
 * comment used to name as an open product decision is now resolved and
 * shipped. `ExperienceFetchOutcome` gained `ExperienceFetchNotPublished`
 * (mobile/lib/startup/last_known_good.dart), `resolveStartup` gained
 * `UseDefaultExperience`, and `AwjRuntimeShell` now calls
 * `resolveRealStartup()` on every real boot and renders Published/Default/
 * LastKnownGood/ControlledUnavailable accordingly — see
 * `docs/plans/mobile/AWJ-RUNTIME-BOOT-1-IMPLEMENTATION-REPORT.md` for the
 * full contract and `mobile/test/app/awj_runtime_shell_startup_test.dart`
 * for the real-shell integration proof.
 *
 * تشغيل: php artisan test --filter=AppBuilderSameStoreProofTest
 */
class AppBuilderSameStoreProofTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const GATEWAY_SECRET = 'app-builder-20-same-store-secret';

    /** @test */
    public function published_app_builder_experience_and_storefront_web_resolve_the_identical_commerce_core_product_data(): void
    {
        config(['storefront.gateway_secret' => self::GATEWAY_SECRET]);

        // ── 1) Tenant (App Builder authoring identity) ──────────────────
        $auth = $this->registerTenant('appb20-same-store', 'owner@appb20-same-store.test');
        $tenantId = $auth['tenant_id'];

        // ── 2) Web channel + Storefront + domain (store/v1) and Mobile
        //      channel + API key (commerce/v1), same tenant ──────────────
        app(TenantContext::class)->set($tenantId);
        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $webChannel->id, 'is_active' => true,
        ]);
        $host = 'appb20-same-store.test';
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host,
            'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $mobileChannel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);

        // ── 3) One real product, published to BOTH channels ─────────────
        $product = Product::create([
            'sku' => 'APPB20-'.Str::random(6), 'name' => 'منتج التطابق', 'name_en' => 'Same-Store Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 12300, 'tax_rate' => 15, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $webChannel->id, 'is_published' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $mobileChannel->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        $tenant = Tenant::find($tenantId);
        $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
        $mobileToken = app(ApiClientKeyService::class)->issueKey($client, 'default', [])->plainTextToken;

        // ── 4) App Builder: author + publish a schema binding ProductList
        //      to commerce.products — the same binding grammar PR #1006's
        //      kHomeSchemaJson uses for real, now authored through the real
        //      Inspector-facing API instead of a bundled Dart constant ─────
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق التطابق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'ProductList', 'id' => 'products', 'binding' => [
                'resource' => 'commerce.products',
                'itemProps' => ['title' => 'name', 'amountMinor' => 'price.amount_minor'],
            ]],
        ];
        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertOk();
        $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/validate")
            ->assertOk()->assertJsonPath('data.valid', true);
        $published = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertCreated();

        // ── 5) Real live fetch — the exact endpoint
        //      experience_fetcher.dart's resolveRealStartup() calls ───────
        $fetched = $this->withHeaders(['Authorization' => 'Bearer '.$mobileToken])
            ->getJson('/commerce/v1/experience')
            ->assertOk();
        $this->assertSame($published->json('data.schema'), $fetched->json('data.schema'));

        // The fetched document, run through the exact same CompatibilityResolver
        // the mobile runtime uses (mirrored Dart-side by CompatibilityResolverTest's
        // own "compatible on the current shipped runtime" tests), is genuinely
        // renderable on this shipped runtime — not just structurally accepted at
        // draft time.
        $result = (new CompatibilityResolver)->resolve($fetched->json('data.schema'), CapabilityManifest::current());
        $this->assertTrue($result->compatible, $result->message ?? '');

        // ── 6) The Same-Store proof itself: commerce/v1 (mobile) and
        //      store/v1 (web) resolve byte-identical data for the SAME
        //      product — the shared Commerce Core data/rules ADR-01
        //      requires this task to demonstrate ───────────────────────
        $mobileProduct = $this->withHeaders(['Authorization' => 'Bearer '.$mobileToken])
            ->getJson('/commerce/v1/products')->assertOk()->json('data.0');
        $webProduct = $this->withHeaders([
            'X-Storefront-Forwarded-Host' => $host,
            'X-Storefront-Gateway-Secret' => self::GATEWAY_SECRET,
        ])->getJson('http://laravel-internal.test/store/v1/products')->assertOk()->json('data.0');

        $this->assertSame($product->id, $mobileProduct['id']);
        $this->assertSame($product->id, $webProduct['id']);
        $this->assertSame('منتج التطابق', $mobileProduct['name']);
        $this->assertSame($mobileProduct['name'], $webProduct['name']);
        $this->assertSame(12300, $mobileProduct['price']['amount_minor']);
        $this->assertSame($mobileProduct['price'], $webProduct['price']);
        $this->assertSame($mobileProduct['in_stock'], $webProduct['in_stock']);

        // ── 7) Category A (Update/Release Matrix, evidence doc §4): a
        //      Commerce Core price change is resolved live by BOTH
        //      channels with no republish, no new native build ───────────
        app(TenantContext::class)->set($tenantId);
        $product->update(['sale_price' => 45600]);
        app(TenantContext::class)->forget();

        $mobileAfter = $this->withHeaders(['Authorization' => 'Bearer '.$mobileToken])
            ->getJson('/commerce/v1/products')->assertOk()->json('data.0');
        $webAfter = $this->withHeaders([
            'X-Storefront-Forwarded-Host' => $host,
            'X-Storefront-Gateway-Secret' => self::GATEWAY_SECRET,
        ])->getJson('http://laravel-internal.test/store/v1/products')->assertOk()->json('data.0');

        $this->assertSame(45600, $mobileAfter['price']['amount_minor']);
        $this->assertSame(45600, $webAfter['price']['amount_minor']);
    }
}
