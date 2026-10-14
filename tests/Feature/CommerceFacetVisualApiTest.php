<?php

namespace Tests\Feature;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceFacetVisual;
use App\Models\CommerceProductFacetValue;
use App\Models\Product;
use App\Models\StorefrontMedia;
use App\Services\Commerce\StorefrontMediaReferenceScanner;
use App\Services\Commerce\StorefrontMediaService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AWJ-VD-H1 / VD-1b — storage and admin API of facet visual identities (§3.2, §3.8-a, §3.8-d).
 *
 * Covers the D-17 version table (create / 428 / 409 / tombstone / ABA / two clients / create race), D-04 RBAC,
 * tenant isolation, strict validation (D-11), media readiness and ownership, D-16 (delete vs save, deterministic
 * orders and the re-scan after the lock), the scanner container and its exclusion from `liveUsageKeys()`, previews
 * for read-only roles, cascades and the additive `GET facets` contract. The real two-process race lives in
 * `CommerceFacetVisualPostgresConcurrencyTest` (pgsql only).
 */
class CommerceFacetVisualApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const BASE = '/api/commerce/workspace/facets';

    /** @return array{token: string, tenant_id: string, facet: CommerceFacet, value: CommerceFacetValue} */
    private function setUpTenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $facet = CommerceFacet::create(['key' => 'occasion', 'name' => 'المناسبة', 'name_en' => 'Occasion']);
        $value = CommerceFacetValue::create(['commerce_facet_id' => $facet->id, 'slug' => 'birthday', 'name' => 'عيد ميلاد']);
        app(TenantContext::class)->forget();

        return $auth + ['facet' => $facet, 'value' => $value];
    }

    private function makeMedia(
        string $tenantId,
        string $variantsState = StorefrontMedia::VARIANTS_READY,
        string $state = StorefrontMedia::STATE_ACTIVE,
    ): string {
        app(TenantContext::class)->set($tenantId);
        $variants = [];
        foreach ([160, 320] as $width) {
            foreach (['webp', 'jpg'] as $format) {
                $variants[] = ['kind' => 'thumb', 'width' => $width, 'height' => $width, 'format' => $format, 'file' => "thumb-{$width}.{$format}", 'bytes' => 100];
            }
        }
        $media = StorefrontMedia::create([
            'tenant_id' => $tenantId,
            'kind' => 'image',
            'original_name' => 'cake.png',
            'mime' => 'image/png',
            'size' => 1234,
            'sha256' => hash('sha256', Str::uuid()->toString()),
            'width' => 800,
            'height' => 800,
            'storage_key' => Str::random(20),
            'variants' => $variants,
            'variants_state' => $variantsState,
            'state' => $state,
        ]);
        app(TenantContext::class)->forget();

        return $media->id;
    }

    private function valuePath(array $t): string
    {
        return self::BASE."/{$t['facet']->id}/values/{$t['value']->id}/visual";
    }

    private function facetPath(array $t): string
    {
        return self::BASE."/{$t['facet']->id}/visual";
    }

    /** @return array<string, mixed> */
    private function listedValue(string $token, string $valueId): array
    {
        $facets = $this->withToken($token)->getJson(self::BASE)->assertOk()->json('data.facets');
        foreach ($facets as $facet) {
            foreach ($facet['values'] as $value) {
                if ($value['id'] === $valueId) {
                    return $value;
                }
            }
        }
        $this->fail('value not listed');
    }

    // ───────────────────────────── D-17: the version table ─────────────────────────────

    /** @test */
    public function create_then_update_then_empty_follows_the_version_table(): void
    {
        $t = $this->setUpTenant('vis-flow');
        $media = $this->makeMedia($t['tenant_id']);
        $client = $this->withToken($t['token']);

        $created = $client->putJson($this->valuePath($t), [
            'visual' => ['image' => ['mediaId' => $media, 'fit' => 'cover', 'focal' => ['x' => 30, 'y' => 70]], 'icon' => 'cake', 'shape' => 'arch'],
            'expected_version' => null,
        ])->assertOk();
        $this->assertSame(1, $created->json('data.version'));
        $this->assertSame('arch', $created->json('data.visual.shape'));
        $this->assertSame($media, $created->json('data.visual.image.mediaId'));

        $updated = $client->putJson($this->valuePath($t), ['visual' => ['shape' => 'circle'], 'expected_version' => 1])->assertOk();
        $this->assertSame(2, $updated->json('data.version'));
        $this->assertSame(['shape' => 'circle'], $updated->json('data.visual'));

        // `visual: null` empties the document (tombstone) and still bumps the version; the row is kept.
        $emptied = $client->putJson($this->valuePath($t), ['visual' => null, 'expected_version' => 2])->assertOk();
        $this->assertNull($emptied->json('data.visual'));
        $this->assertSame(3, $emptied->json('data.version'));
        $this->assertSame(1, CommerceFacetVisual::withoutGlobalScopes()->count());
        // The tombstone is stored as a JSON object, never an array.
        $this->assertSame('{}', str_replace(' ', '', (string) DB::table('commerce_facet_visuals')->value('visual')));

        // Decision 1: the list shows `visual: null` with the kept version, so the client can write again.
        $listed = $this->listedValue($t['token'], $t['value']->id);
        $this->assertNull($listed['visual']);
        $this->assertSame(3, $listed['visual_version']);
        $this->assertNull($listed['visual_preview']);

        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'gift'], 'expected_version' => 3])
            ->assertOk()->assertJsonPath('data.version', 4);
    }

    /** @test */
    public function an_existing_row_without_expected_version_is_428(): void
    {
        $t = $this->setUpTenant('vis-428');
        $client = $this->withToken($t['token']);
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => null])->assertOk();

        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'gift']])
            ->assertStatus(428)->assertJsonPath('code', 'visual_precondition_required');
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'gift'], 'expected_version' => null])
            ->assertStatus(428);
        $this->assertSame(['icon' => 'cake'], CommerceFacetVisual::withoutGlobalScopes()->first()->visual);
    }

    /** @test */
    public function a_number_when_no_row_exists_is_409_with_null_current_version(): void
    {
        $t = $this->setUpTenant('vis-409-none');

        $this->withToken($t['token'])->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => 1])
            ->assertStatus(409)
            ->assertJsonPath('code', 'visual_version_conflict')
            ->assertJsonPath('current_version', null);
        $this->assertSame(0, CommerceFacetVisual::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_stale_version_is_409_with_the_current_version_and_writes_nothing(): void
    {
        $t = $this->setUpTenant('vis-409-stale');
        $client = $this->withToken($t['token']);
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => null])->assertOk();
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'gift'], 'expected_version' => 1])->assertOk();

        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'moon'], 'expected_version' => 1])
            ->assertStatus(409)
            ->assertJsonPath('current_version', 2);
        $this->assertSame(['icon' => 'gift'], CommerceFacetVisual::withoutGlobalScopes()->first()->visual);
    }

    /** @test */
    public function aba_a_stale_token_never_matches_after_empty_and_rewrite(): void
    {
        $t = $this->setUpTenant('vis-aba');
        $client = $this->withToken($t['token']);
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => null])->assertOk(); // A reads v1
        $client->putJson($this->valuePath($t), ['visual' => null, 'expected_version' => 1])->assertOk();                 // B empties (v2)
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'gift'], 'expected_version' => 2])->assertOk();    // C writes (v3)

        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'moon'], 'expected_version' => 1])                  // A writes on v1
            ->assertStatus(409)->assertJsonPath('current_version', 3);
    }

    /** @test */
    public function two_clients_reading_the_same_version_first_wins_second_gets_409(): void
    {
        $t = $this->setUpTenant('vis-two');
        $client = $this->withToken($t['token']);
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => null])->assertOk();

        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'gift'], 'expected_version' => 1])->assertOk();
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'moon'], 'expected_version' => 1])->assertStatus(409);
    }

    /** @test */
    public function a_create_that_loses_the_unique_index_race_is_409_not_500(): void
    {
        $t = $this->setUpTenant('vis-race');
        // Deterministic stand-in for the pgsql race: a competing row is inserted right before ours.
        CommerceFacetVisual::creating(function (CommerceFacetVisual $visual) {
            DB::table('commerce_facet_visuals')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $visual->tenant_id,
                'commerce_facet_id' => $visual->commerce_facet_id,
                'commerce_facet_value_id' => $visual->commerce_facet_value_id,
                'schema_version' => 1,
                'visual' => '{"icon":"gift"}',
                'version' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        $this->withToken($t['token'])->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => null])
            ->assertStatus(409)
            ->assertJsonPath('code', 'visual_version_conflict')
            // The competing row was rolled back with our transaction here; under real concurrency (pgsql test) it
            // is the winner's committed version.
            ->assertJsonPath('current_version', null);
    }

    /** @test */
    public function the_indexes_allow_one_row_per_value_and_one_self_row_per_facet(): void
    {
        $t = $this->setUpTenant('vis-index');
        $row = fn (?string $valueId) => [
            'id' => (string) Str::uuid(), 'tenant_id' => $t['tenant_id'], 'commerce_facet_id' => $t['facet']->id,
            'commerce_facet_value_id' => $valueId, 'schema_version' => 1, 'visual' => '{}', 'version' => 1,
        ];
        DB::table('commerce_facet_visuals')->insert($row(null));
        DB::table('commerce_facet_visuals')->insert($row($t['value']->id));

        foreach ([null, $t['value']->id] as $valueId) {
            try {
                // A savepoint per attempt: on PostgreSQL a failed statement aborts the surrounding transaction, so
                // without it the second attempt would fail with 25P02 instead of proving its own index.
                DB::transaction(fn () => DB::table('commerce_facet_visuals')->insert($row($valueId)));
                $this->fail('a second row for the same owner must be rejected');
            } catch (\Illuminate\Database\QueryException $e) {
                $sqlState = $e->errorInfo[0] ?? null;
                $this->assertTrue(
                    $sqlState === '23505' || ($sqlState === '23000' && str_contains(strtoupper((string) $e->errorInfo[2]), 'UNIQUE')),
                    'expected a unique violation, got '.$e->getMessage(),
                );
            }
        }
    }

    // ───────────────────────────── the facet row: self + defaults ─────────────────────────────

    /** @test */
    public function the_facet_row_stores_self_and_defaults_with_its_own_preview(): void
    {
        $t = $this->setUpTenant('vis-facet');
        $media = $this->makeMedia($t['tenant_id']);

        $res = $this->withToken($t['token'])->putJson($this->facetPath($t), [
            'visual' => [
                'self' => ['image' => ['mediaId' => $media, 'fit' => 'contain'], 'shape' => 'rounded'],
                'defaults' => ['icon' => 'gift', 'shape' => 'circle', 'size' => 'lg'],
            ],
            'expected_version' => null,
        ])->assertOk();
        $this->assertSame('rounded', $res->json('data.visual.self.shape'));
        $this->assertSame('circle', $res->json('data.visual.defaults.shape'));

        $facet = $this->withToken($t['token'])->getJson(self::BASE)->assertOk()->json('data.facets.0');
        $this->assertSame(1, $facet['visual_version']);
        $this->assertStringContainsString('signature=', $facet['visual_preview']['thumb_160']);
        $this->assertStringContainsString('thumb-320.webp', $facet['visual_preview']['thumb_320']);
        $this->assertNull($facet['values'][0]['visual']);
    }

    // ───────────────────────────── D-11: strict writes ─────────────────────────────

    /** @test */
    public function invalid_fields_are_422_with_stable_field_codes_and_write_nothing(): void
    {
        $t = $this->setUpTenant('vis-422');
        $client = $this->withToken($t['token']);

        $client->putJson($this->valuePath($t), ['visual' => ['shape' => 'blob', 'iconColor' => 'red', 'icon' => '<svg>'], 'expected_version' => null])
            ->assertStatus(422)
            ->assertJsonPath('code', 'visual_invalid')
            ->assertJsonPath('errors', [
                'visual.icon' => ['unknown_icon'],
                'visual.iconColor' => ['invalid_color'],
                'visual.shape' => ['unknown_shape'],
            ]);
        $client->putJson($this->valuePath($t), ['visual' => ['image' => ['mediaId' => (string) Str::uuid(), 'crop' => [0, 0, 1, 1]]], 'expected_version' => null])
            ->assertStatus(422)->assertJsonPath('errors', ['visual.image.crop' => ['forbidden']]);
        $client->putJson($this->valuePath($t), ['visual' => ['cake'], 'expected_version' => null])
            ->assertStatus(422)->assertJsonPath('errors', ['visual' => ['invalid_object']]);
        $client->putJson($this->facetPath($t), ['visual' => ['defaults' => ['image' => []]], 'expected_version' => null])
            ->assertStatus(422)->assertJsonPath('errors', ['visual.defaults.image' => ['unknown_field']]);

        $this->assertSame(0, CommerceFacetVisual::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_body_accepts_only_visual_and_expected_version(): void
    {
        $t = $this->setUpTenant('vis-envelope');
        $client = $this->withToken($t['token']);

        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => null, 'tenant_id' => $t['tenant_id']])
            ->assertStatus(422);
        $client->putJson($this->valuePath($t), ['expected_version' => null])->assertStatus(422);
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => 0])->assertStatus(422);
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => 'x'])->assertStatus(422);
        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => null])->assertOk();

        // D-17: only a JSON integer is a version token.
        foreach ([true, '1', 1.5] as $token) {
            $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'gift'], 'expected_version' => $token])
                ->assertStatus(422)->assertJsonPath('code', 'visual_invalid');
        }
        // A raw body, because PHP would encode 1.0 as 1: JSON `1.0` decodes to a float and is not a token.
        $server = $this->transformHeadersToServerVars([
            'Content-Type' => 'application/json', 'Accept' => 'application/json', 'Authorization' => 'Bearer '.$t['token'],
        ]);
        $this->call('PUT', $this->valuePath($t), [], [], [], $server, '{"visual":{"icon":"gift"},"expected_version":1.0}')
            ->assertStatus(422);
        // A query string never feeds the token or the document.
        $client->putJson($this->valuePath($t).'?expected_version=1', ['visual' => ['icon' => 'gift']])->assertStatus(422);
        // `""` is not "remove identity" (the empty-string middleware must not turn it into null).
        $client->putJson($this->valuePath($t), ['visual' => '', 'expected_version' => 1])
            ->assertStatus(422)->assertJsonPath('errors', ['visual' => ['invalid_object']]);
        $this->assertSame(['icon' => 'cake'], CommerceFacetVisual::withoutGlobalScopes()->first()->visual);
    }

    /** @test */
    public function media_must_be_this_tenants_active_and_ready_library_image(): void
    {
        $t = $this->setUpTenant('vis-media');
        $other = $this->setUpTenant('vis-media-other');
        $client = $this->withToken($t['token']);
        $body = fn (string $id) => ['visual' => ['image' => ['mediaId' => $id]], 'expected_version' => null];

        // Decision 3: not ready yet → media_not_ready.
        $client->putJson($this->valuePath($t), $body($this->makeMedia($t['tenant_id'], StorefrontMedia::VARIANTS_PENDING)))
            ->assertStatus(422)->assertJsonPath('errors', ['visual.image.mediaId' => ['media_not_ready']]);
        $client->putJson($this->valuePath($t), $body($this->makeMedia($t['tenant_id'], StorefrontMedia::VARIANTS_FAILED)))
            ->assertStatus(422)->assertJsonPath('errors', ['visual.image.mediaId' => ['media_not_ready']]);
        // Deleted, another tenant's, or unknown: indistinguishable media_not_found.
        foreach ([
            $this->makeMedia($t['tenant_id'], StorefrontMedia::VARIANTS_READY, StorefrontMedia::STATE_DELETED),
            $this->makeMedia($other['tenant_id']),
            (string) Str::uuid(),
        ] as $id) {
            $client->putJson($this->valuePath($t), $body($id))
                ->assertStatus(422)->assertJsonPath('errors', ['visual.image.mediaId' => ['media_not_found']]);
        }
        $this->assertSame(0, CommerceFacetVisual::withoutGlobalScopes()->count());
    }

    // ───────────────────────────── D-04: RBAC ─────────────────────────────

    /** @test */
    public function only_commerce_managers_write_visuals_while_products_managers_keep_editing_names(): void
    {
        $t = $this->setUpTenant('vis-rbac');
        $body = ['visual' => ['icon' => 'cake'], 'expected_version' => null];

        $accountant = $this->tokenForRole($t['tenant_id'], 'accountant', 'acc@vis-rbac.test');
        $this->withToken($accountant)->putJson($this->valuePath($t), $body)->assertForbidden();
        $this->withToken($accountant)->putJson($this->facetPath($t), ['visual' => ['defaults' => ['icon' => 'cake']], 'expected_version' => null])->assertForbidden();
        $this->withToken($accountant)->putJson(self::BASE."/{$t['facet']->id}", ['name' => 'المناسبات'])->assertOk();

        $this->withToken($this->tokenForRole($t['tenant_id'], 'staff', 'staff@vis-rbac.test'))
            ->putJson($this->valuePath($t), $body)->assertForbidden();
        $this->withToken($this->tokenForRole($t['tenant_id'], 'self_service', 'self@vis-rbac.test'))
            ->putJson($this->valuePath($t), $body)->assertForbidden();
        $this->flushHeaders();
        $this->app['auth']->forgetGuards();
        $this->putJson($this->valuePath($t), $body)->assertUnauthorized();

        $this->withToken($this->tokenForRole($t['tenant_id'], 'admin', 'admin@vis-rbac.test'))
            ->putJson($this->valuePath($t), $body)->assertOk();
        $this->withToken($t['token'])->putJson($this->valuePath($t), ['visual' => ['icon' => 'gift'], 'expected_version' => 1])->assertOk();
    }

    /** @test */
    public function a_read_only_role_sees_previews_but_cannot_read_the_library(): void
    {
        $t = $this->setUpTenant('vis-preview');
        $media = $this->makeMedia($t['tenant_id']);
        $unrelated = $this->makeMedia($t['tenant_id']);
        $this->withToken($t['token'])->putJson($this->valuePath($t), ['visual' => ['image' => ['mediaId' => $media]], 'expected_version' => null])->assertOk();

        $accountant = $this->tokenForRole($t['tenant_id'], 'accountant', 'acc@vis-preview.test');
        $response = $this->withToken($accountant)->getJson(self::BASE)->assertOk();
        $preview = $response->json('data.facets.0.values.0.visual_preview');
        $this->assertStringContainsString("/{$media}/variants/thumb-160.webp", $preview['thumb_160']);
        // Only referenced media get links; the library itself stays commerce.manage-only.
        $this->assertStringNotContainsString($unrelated, $response->getContent());
        $this->withToken($accountant)->getJson('/api/commerce/workspace/storefront-media')->assertForbidden();

        // The link is a valid signature now (the signature is its only authority) and expires after 20 minutes.
        $this->assertTrue(\Illuminate\Support\Facades\URL::hasValidSignature(\Illuminate\Http\Request::create($preview['thumb_160'])));
        $this->travel(21)->minutes();
        $this->assertFalse(\Illuminate\Support\Facades\URL::hasValidSignature(\Illuminate\Http\Request::create($preview['thumb_160'])));
        $this->flushHeaders();
        $this->app['auth']->forgetGuards();
        $path = parse_url($preview['thumb_160'], PHP_URL_PATH).'?'.parse_url($preview['thumb_160'], PHP_URL_QUERY);
        $this->get($path)->assertForbidden();
    }

    /** @test */
    public function signed_previews_never_point_at_the_original(): void
    {
        $t = $this->setUpTenant('vis-original');
        $media = $this->makeMedia($t['tenant_id']);
        app(TenantContext::class)->set($t['tenant_id']);
        $asset = StorefrontMedia::find($media);

        $this->assertNull(app(StorefrontMediaService::class)->signedUrl($asset, 'cake.png'));
        $this->assertNull(app(StorefrontMediaService::class)->signedUrl($asset, 'original.png'));
    }

    // ───────────────────────────── tenant isolation ─────────────────────────────

    /** @test */
    public function another_tenants_facet_or_value_is_the_same_non_revealing_404(): void
    {
        $a = $this->setUpTenant('vis-iso-a');
        $b = $this->setUpTenant('vis-iso-b');
        $body = ['visual' => ['icon' => 'cake'], 'expected_version' => null];
        $client = $this->withToken($b['token']);

        $foreign = $client->putJson($this->valuePath($a), $body)->assertNotFound();
        $missing = $client->putJson(self::BASE.'/'.Str::uuid().'/values/'.Str::uuid().'/visual', $body)->assertNotFound();
        $this->assertSame($missing->json('message'), $foreign->json('message'));
        $client->putJson($this->facetPath($a), ['visual' => ['defaults' => ['icon' => 'cake']], 'expected_version' => null])->assertNotFound();
        // B's facet with A's value id: the value must belong to the facet in the path.
        $client->putJson(self::BASE."/{$b['facet']->id}/values/{$a['value']->id}/visual", $body)->assertNotFound();

        $this->assertSame(0, CommerceFacetVisual::withoutGlobalScopes()->count());
        $listed = $this->withToken($a['token'])->getJson(self::BASE)->assertOk()->json('data.facets.0');
        $this->assertNull($listed['visual']);
    }

    // ───────────────────────────── decision 2: inactive owners ─────────────────────────────

    /** @test */
    public function inactive_facets_and_values_can_be_prepared(): void
    {
        $t = $this->setUpTenant('vis-inactive');
        app(TenantContext::class)->set($t['tenant_id']);
        $t['facet']->update(['is_active' => false]);
        $t['value']->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $this->withToken($t['token'])->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => null])->assertOk();
        $this->withToken($t['token'])->putJson($this->facetPath($t), ['visual' => ['defaults' => ['shape' => 'arch']], 'expected_version' => null])->assertOk();
    }

    // ───────────────────────────── cascades ─────────────────────────────

    /** @test */
    public function deleting_a_value_or_facet_removes_its_visuals_and_nothing_else(): void
    {
        $t = $this->setUpTenant('vis-cascade');
        $client = $this->withToken($t['token']);
        app(TenantContext::class)->set($t['tenant_id']);
        $second = CommerceFacetValue::create(['commerce_facet_id' => $t['facet']->id, 'slug' => 'wedding', 'name' => 'زفاف']);
        $product = Product::create(['name' => 'باقة', 'sku' => 'VIS-1']);
        CommerceProductFacetValue::create(['product_id' => $product->id, 'commerce_facet_value_id' => $second->id]);
        app(TenantContext::class)->forget();

        $client->putJson($this->valuePath($t), ['visual' => ['icon' => 'cake'], 'expected_version' => null])->assertOk();
        $client->putJson(self::BASE."/{$t['facet']->id}/values/{$second->id}/visual", ['visual' => ['icon' => 'gem'], 'expected_version' => null])->assertOk();
        $client->putJson($this->facetPath($t), ['visual' => ['defaults' => ['icon' => 'gift']], 'expected_version' => null])->assertOk();

        $client->deleteJson(self::BASE."/{$t['facet']->id}/values/{$t['value']->id}")->assertOk();
        $this->assertSame(2, CommerceFacetVisual::withoutGlobalScopes()->count());
        $this->assertSame(1, CommerceProductFacetValue::withoutGlobalScopes()->count(), 'assignments of other values are untouched');

        // Deleting the facet takes its own row and its values' rows with it.
        app(TenantContext::class)->set($t['tenant_id']);
        CommerceProductFacetValue::query()->delete();
        app(TenantContext::class)->forget();
        $client->deleteJson(self::BASE."/{$t['facet']->id}")->assertOk();
        $this->assertSame(0, CommerceFacetVisual::withoutGlobalScopes()->count());
    }

    // ───────────────────────────── media protection (§3.8-d, D-16) ─────────────────────────────

    /** @test */
    public function a_media_used_by_a_facet_visual_cannot_be_deleted_until_the_visual_lets_go(): void
    {
        $t = $this->setUpTenant('vis-protect');
        $media = $this->makeMedia($t['tenant_id']);
        $client = $this->withToken($t['token']);
        $client->putJson($this->valuePath($t), ['visual' => ['image' => ['mediaId' => $media]], 'expected_version' => null])->assertOk();

        $client->deleteJson("/api/commerce/workspace/storefront-media/{$media}")
            ->assertStatus(409)
            ->assertJsonPath('code', 'media_in_use')
            ->assertJsonPath('usage.0.container', 'facet_visual')
            ->assertJsonPath('usage.0.storefront_id', '');
        $client->getJson("/api/commerce/workspace/storefront-media/{$media}/usage")
            ->assertOk()->assertJsonPath('data.usage.0.container', 'facet_visual');
        $unused = $client->getJson('/api/commerce/workspace/storefront-media?unused=1')->assertOk()->json('data');
        $this->assertNotContains($media, array_column($unused, 'id'));

        // Removing the identity (tombstone) releases the media.
        $client->putJson($this->valuePath($t), ['visual' => null, 'expected_version' => 1])->assertOk();
        $client->deleteJson("/api/commerce/workspace/storefront-media/{$media}")->assertOk();
    }

    /** @test */
    public function delete_then_save_the_save_sees_the_deletion_and_is_422(): void
    {
        $t = $this->setUpTenant('vis-d16-a');
        $media = $this->makeMedia($t['tenant_id']);
        $client = $this->withToken($t['token']);

        $client->deleteJson("/api/commerce/workspace/storefront-media/{$media}")->assertOk();
        $client->putJson($this->valuePath($t), ['visual' => ['image' => ['mediaId' => $media]], 'expected_version' => null])
            ->assertStatus(422)->assertJsonPath('errors', ['visual.image.mediaId' => ['media_not_found']]);
    }

    /** @test */
    public function save_then_delete_with_a_stale_model_the_delete_rescans_after_its_lock_and_is_409(): void
    {
        $t = $this->setUpTenant('vis-d16-b');
        $media = $this->makeMedia($t['tenant_id']);
        app(TenantContext::class)->set($t['tenant_id']);
        $stale = StorefrontMedia::find($media); // loaded before the reference exists
        app(TenantContext::class)->forget();

        $this->withToken($t['token'])->putJson($this->valuePath($t), ['visual' => ['image' => ['mediaId' => $media]], 'expected_version' => null])->assertOk();

        app(TenantContext::class)->set($t['tenant_id']);
        try {
            app(StorefrontMediaService::class)->delete($stale);
            $this->fail('the delete must see the reference written after the model was loaded');
        } catch (\App\Services\Commerce\StorefrontMediaException $e) {
            $this->assertSame('media_in_use', $e->errorCode);
        }
        $this->assertSame(StorefrontMedia::STATE_ACTIVE, StorefrontMedia::find($media)->state);
    }

    /** @test */
    public function delete_locks_the_media_row_then_rescans_inside_the_same_transaction(): void
    {
        $t = $this->setUpTenant('vis-d16-c');
        $media = $this->makeMedia($t['tenant_id']);
        app(TenantContext::class)->set($t['tenant_id']);
        $asset = StorefrontMedia::find($media);

        $baseline = DB::transactionLevel();
        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = ['sql' => strtolower($query->sql), 'level' => DB::transactionLevel()];
        });
        app(StorefrontMediaService::class)->delete($asset);

        $lock = collect($queries)->search(fn ($q) => str_contains($q['sql'], 'from "storefront_media"') && str_starts_with($q['sql'], 'select'));
        $scan = collect($queries)->search(fn ($q) => str_contains($q['sql'], 'from "commerce_facet_visuals"'));
        $this->assertNotFalse($lock, 'the media row is re-read under lock');
        $this->assertNotFalse($scan, 'facet visuals are scanned');
        $this->assertLessThan($scan, $lock, 'lock first, then scan');
        $this->assertSame($baseline + 1, $queries[$lock]['level']);
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->assertStringContainsString('for update', $queries[$lock]['sql'], 'the media row is locked, not just read');
        }
        $this->assertSame($baseline + 1, $queries[$scan]['level']);
        $this->assertSame(StorefrontMedia::STATE_DELETED, StorefrontMedia::find($media)->state);
        $this->assertSame(StorefrontMedia::STATE_DELETED, $asset->state, 'the caller model reflects the deletion');
    }

    /** @test */
    public function facet_visuals_are_references_but_never_live_derivative_usage(): void
    {
        $t = $this->setUpTenant('vis-live');
        $media = $this->makeMedia($t['tenant_id']);
        $this->withToken($t['token'])->putJson($this->valuePath($t), [
            'visual' => ['image' => ['mediaId' => $media, 'fit' => 'contain', 'focal' => ['x' => 10, 'y' => 90]]],
            'expected_version' => null,
        ])->assertOk();

        app(TenantContext::class)->set($t['tenant_id']);
        $scanner = app(StorefrontMediaReferenceScanner::class);
        $this->assertNotSame([], $scanner->referencesFor([$media])[$media]);
        $this->assertArrayHasKey($media, $scanner->allReferencedIds());
        // Framing is CSS over base thumbnails: no baked derivative may be kept alive by a facet visual.
        $this->assertArrayNotHasKey($media, $scanner->liveUsageKeys());
    }

    // ───────────────────────────── additive list contract ─────────────────────────────

    /** @test */
    public function the_list_only_adds_the_three_visual_keys(): void
    {
        $t = $this->setUpTenant('vis-list');
        $facet = $this->withToken($t['token'])->getJson(self::BASE)->assertOk()->json('data.facets.0');

        $this->assertSame(
            ['id', 'key', 'system_key', 'name', 'name_en', 'sort_order', 'is_active', 'values', 'visual', 'visual_version', 'visual_preview'],
            array_keys($facet),
        );
        $this->assertSame(
            ['id', 'slug', 'name', 'name_en', 'sort_order', 'is_active', 'product_count', 'visual', 'visual_version', 'visual_preview'],
            array_keys($facet['values'][0]),
        );
        $this->assertNull($facet['visual']);
        $this->assertNull($facet['values'][0]['visual_version']);
    }
}
