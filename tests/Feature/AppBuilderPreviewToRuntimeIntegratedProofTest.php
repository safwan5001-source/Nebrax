<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\AppBuilder\CapabilityManifest;
use App\Services\AppBuilder\CompatibilityResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * LIVE-PREVIEW-7 (`AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`) — the backend half of the
 * integrated proof this task's own charter requires:
 *
 *   Builder Draft -> Preview -> Validate -> Publish -> commerce/v1/experience
 *   -> real startup resolver -> runtime compatibility -> runtime rendering
 *
 * This test proves the **first five stages** with real HTTP round trips, no mocking, on the
 * exact canonical fixture at `contracts/app-builder/integrated-proof-schema.v1.json` — the same
 * fixture `web/src/modules/app-builder/integrated-proof-schema.test.ts` asserts Preview renders
 * correctly, and the same fixture `mobile/test/app/awj_runtime_shell_startup_test.dart`'s
 * integrated-proof case asserts the real Flutter runtime resolver/compatibility/rendering
 * pipeline accepts and renders. A single literal test spanning PHP/TypeScript/Dart in one
 * process is not feasible (three separate toolchains, three separate CI jobs) — this is the same
 * shared-fixture discipline LIVE-PREVIEW-2 established for `runtime-contract.ts`/
 * `binding_resolution.dart`, applied here to one whole document instead of individual cases.
 *
 * Deliberately reuses `AppBuilderSameStoreProofTest`'s proven setup pattern (mobile
 * `SalesChannel` + `ApiClientKeyService` store-bearer token, the exact `GET commerce/v1/
 * experience` endpoint `experience_fetcher.dart` calls in production) rather than inventing a
 * new one — this test's own addition is asserting the *same* canonical fixture round-trips
 * byte-identically end-to-end, not a new endpoint or auth path.
 *
 * تشغيل: php artisan test --filter=AppBuilderPreviewToRuntimeIntegratedProofTest
 */
class AppBuilderPreviewToRuntimeIntegratedProofTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array<string, mixed> */
    private function loadFixture(): array
    {
        $path = base_path('contracts/app-builder/integrated-proof-schema.v1.json');
        $this->assertFileExists($path, 'Shared LIVE-PREVIEW-7 integrated-proof fixture must exist.');

        return json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    }

    /** @test */
    public function the_canonical_fixture_round_trips_byte_identically_from_draft_through_publish_to_a_real_mobile_fetch_and_resolves_compatible(): void
    {
        $fixture = $this->loadFixture();

        // ── 1) Draft — the exact same document Preview renders is accepted as-authored. ──
        $auth = $this->registerTenant('appb-lp7-proof', 'owner@appb-lp7-proof.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'إثبات متكامل', 'creation_source' => 'scratch',
        ])->assertCreated()->json('data.id');

        $draft = $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $fixture])
            ->assertOk();
        $this->assertSame($fixture, $draft->json('data.schema'), 'Draft save must not mutate the authored fixture.');

        // ── 2) Validate — the real Validate -> Publish boundary (`CompatibilityResolver`,
        //      same code LIVE-PREVIEW-5 strengthened) accepts it before any publish happens. ──
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/validate")
            ->assertOk()->assertJsonPath('data.valid', true);

        // ── 3) Publish — a real, immutable published version. ──
        $published = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/versions", ['note' => 'LIVE-PREVIEW-7 integrated proof'])
            ->assertCreated();
        $published->assertJsonPath('data.version', 1);
        $this->assertSame($fixture, $published->json('data.schema'), 'Publish must not mutate the authored fixture.');

        // ── 4) A real mobile fetch — the exact endpoint `experience_fetcher.dart`'s
        //      `resolveRealStartup()` calls in production, authenticated the same way (a
        //      store-bearer token issued to a real `mobile` SalesChannel client, not the
        //      merchant's own Sanctum session). ──
        $tenant = Tenant::find($auth['tenant_id']);
        app(\App\Tenancy\TenantContext::class)->set($tenant->id);
        SalesChannel::create(['slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        app(\App\Tenancy\TenantContext::class)->forget();
        $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
        $mobileToken = app(ApiClientKeyService::class)->issueKey($client, 'default', [])->plainTextToken;

        $fetched = $this->withHeaders(['Authorization' => 'Bearer '.$mobileToken])
            ->getJson('/commerce/v1/experience')
            ->assertOk();
        $this->assertSame(
            $fixture,
            $fetched->json('data.schema'),
            'The document a real mobile client fetches must be byte-identical to the one Preview rendered and Draft/Publish accepted — this is the entire point of the round trip.'
        );

        // ── 5) Runtime compatibility — the exact same `CompatibilityResolver`/
        //      `CapabilityManifest::current()` the shipped mobile runtime's Dart mirror uses
        //      (proven identical by `CompatibilityResolverTest`'s own "compatible on the
        //      current shipped runtime" cases) accepts the fetched document as genuinely
        //      renderable, not merely structurally well-formed. ──
        $result = (new CompatibilityResolver)->resolve($fetched->json('data.schema'), CapabilityManifest::current());
        $this->assertTrue($result->compatible, $result->message ?? 'expected the integrated-proof fixture to be compatible with the current shipped runtime');
        $this->assertSame([], $result->fallbacks, 'The fixture uses only components/actions/bindings already proven supported — no node should need an optional fallback.');
    }

    /** @test */
    public function the_fixture_itself_only_uses_components_actions_and_bindings_the_current_shipped_runtime_manifest_declares(): void
    {
        // A narrower, structural companion assertion: even before any HTTP round trip, the
        // fixture's own component/action/resource vocabulary is a subset of what
        // `RuntimeCapabilities`/`DataResourceRegistry` currently declare supported — so a
        // future capability being *removed* from the manifest would fail this fixture loudly,
        // not silently leave a stale integrated-proof schema behind.
        $fixture = $this->loadFixture();
        $manifest = CapabilityManifest::current();

        $types = [];
        $walk = function (array $node) use (&$walk, &$types): void {
            $types['components'][$node['type']] = true;
            if (isset($node['action']['type'])) {
                $types['actions'][$node['action']['type']] = true;
            }
            if (isset($node['binding']['resource'])) {
                $types['resources'][$node['binding']['resource']] = true;
            }
            foreach ($node['children'] ?? [] as $child) {
                $walk($child);
            }
        };
        foreach ($fixture['pages'] as $page) {
            $walk($page);
        }

        foreach (array_keys($types['components'] ?? []) as $component) {
            $this->assertNotNull($manifest->componentVersion($component), "component \"{$component}\" must be in RuntimeCapabilities::COMPONENTS");
        }
        foreach (array_keys($types['actions'] ?? []) as $action) {
            $this->assertNotNull($manifest->actionVersion($action), "action \"{$action}\" must be in RuntimeCapabilities::ACTIONS");
        }
        foreach (array_keys($types['resources'] ?? []) as $resource) {
            $this->assertNotNull($manifest->resourceVersion($resource), "resource \"{$resource}\" must be in RuntimeCapabilities::DATA_RESOURCES");
        }
        $this->assertNotNull($manifest->schemaFeatureVersion('binding.collect'), 'the fixture uses binding.collect on CartList, which requires this schema feature to be enabled.');
    }
}
