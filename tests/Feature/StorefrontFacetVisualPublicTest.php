<?php

namespace Tests\Feature;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceFacetVisual;
use App\Models\CommerceListing;
use App\Models\CommerceProductFacetValue;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\StorefrontMedia;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\StorefrontFacetVisualProjector;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * AWJ-VD-H1 / VD-1c — public projection of facet visuals in `storefront.v1` `meta.facets` and the guarded image
 * route `store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}` (§3.8-b/c, D-03/D-05/D-15, owner decisions D1–D4).
 *
 * Covers the mandatory negative cache / leak table N1–N19 (§3.8-f) one test each, plus the projection contract (D1:
 * normalized documents + `sources`), legacy routes (D2: `visual: null`), the uniform `no-store` 404 (D4) and the
 * guards running before `If-None-Match` (D3: a revalidation is re-authorized).
 *
 * Run: php artisan test --filter=StorefrontFacetVisualPublicTest
 */
class StorefrontFacetVisualPublicTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;
    use StorefrontMediaTestSupport;

    private const FACETS = '/api/commerce/workspace/facets';
    private const MEDIA = '/api/commerce/workspace/storefront-media';

    private int $uploads = 0;

    // ═════════════════ fixtures ═════════════════

    /**
     * A tenant with a verified storefront on the `web` channel, the facet «occasion» (birthday, wedding, party) and
     * one active product published on that channel, assigned to birthday and wedding. «party» has no product.
     *
     * @return array<string, mixed>
     */
    private function store(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $seed = $this->seedMediaStorefront($auth['tenant_id']);
        $host = "{$slug}.example.com";

        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontDomain::create([
            'storefront_id' => $seed['storefront']->id,
            'hostname' => $host,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $facet = CommerceFacet::create(['key' => 'occasion', 'name' => 'المناسبة', 'name_en' => 'Occasion', 'system_key' => 'occasion']);
        $values = [];
        foreach (['birthday', 'wedding', 'party'] as $i => $valueSlug) {
            $values[$valueSlug] = CommerceFacetValue::create([
                'commerce_facet_id' => $facet->id, 'slug' => $valueSlug, 'name' => ucfirst($valueSlug), 'sort_order' => $i,
            ]);
        }
        $product = $this->product($seed['channel']);
        foreach (['birthday', 'wedding'] as $valueSlug) {
            CommerceProductFacetValue::create(['product_id' => $product->id, 'commerce_facet_value_id' => $values[$valueSlug]->id]);
        }
        app(TenantContext::class)->forget();

        return [
            'auth' => $auth,
            'tenant_id' => $auth['tenant_id'],
            'storefront' => $seed['storefront'],
            'channel' => $seed['channel'],
            'host' => $host,
            'facet' => $facet,
            'values' => $values,
            'product' => $product,
        ];
    }

    /** Call with the tenant context set. */
    private function product(SalesChannel $channel, bool $published = true): Product
    {
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج '.Str::random(4), 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 10000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => $published]);

        return $product;
    }

    /** A real upload: the variant ladder (thumbs, 480w, 768w…) is generated and stored in the faked R2. */
    private function uploadMedia(array $store): string
    {
        $width = 1600 + $this->uploads++; // identical bytes deduplicate inside a tenant
        $json = $this->withToken($store['auth']['token'])
            ->post(self::MEDIA, ['files' => [$this->upload($this->jpegBytes($width, 900))]], ['Accept' => 'application/json'])
            ->json();
        $this->flushHeaders();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media']['id'];
    }

    /** Writes through the VD-1b admin API (D-16 media checks, D-17 versions); returns the new version. */
    private function putValueVisual(array $store, string $valueSlug, ?array $visual, ?int $expected): int
    {
        $path = self::FACETS."/{$store['facet']->id}/values/{$store['values'][$valueSlug]->id}/visual";
        $version = $this->withToken($store['auth']['token'])
            ->putJson($path, ['visual' => $visual, 'expected_version' => $expected])
            ->assertOk()
            ->json('data.version');
        $this->flushHeaders();

        return $version;
    }

    private function putFacetVisual(array $store, ?array $visual, ?int $expected): int
    {
        $version = $this->withToken($store['auth']['token'])
            ->putJson(self::FACETS."/{$store['facet']->id}/visual", ['visual' => $visual, 'expected_version' => $expected])
            ->assertOk()
            ->json('data.version');
        $this->flushHeaders();

        return $version;
    }

    private function visualRow(array $store, ?string $valueSlug): CommerceFacetVisual
    {
        app(TenantContext::class)->set($store['tenant_id']);
        $row = CommerceFacetVisual::query()
            ->where('commerce_facet_id', $store['facet']->id)
            ->where('commerce_facet_value_id', $valueSlug === null ? null : $store['values'][$valueSlug]->id)
            ->firstOrFail();
        app(TenantContext::class)->forget();

        return $row;
    }

    private function products(array $store, string $query = ''): TestResponse
    {
        return $this->get("http://{$store['host']}/store/v1/products".($query === '' ? '' : "?{$query}"))->assertOk();
    }

    /** @return array<string, mixed>|null the occasion facet of `meta.facets`, or null when it is absent */
    private function metaFacet(TestResponse $response): ?array
    {
        return collect($response->json('meta.facets'))->firstWhere('key', 'occasion');
    }

    /** @return array<string, mixed>|null */
    private function metaValue(TestResponse $response, string $slug): ?array
    {
        return collect($this->metaFacet($response)['values'] ?? [])->firstWhere('slug', $slug);
    }

    private function image(array $store, string $visualId, string $mediaId, string $file = '480w.webp', array $headers = []): TestResponse
    {
        return $this->get("http://{$store['host']}/store/v1/media/facet-visuals/{$visualId}/{$mediaId}/{$file}", $headers);
    }

    private function assertUniform404(TestResponse $response, string $label = ''): void
    {
        $this->assertSame(404, $response->getStatusCode(), "expected a 404: {$label}");
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'), "404 without no-store: {$label}");
        $this->assertStringNotContainsString('public', (string) $response->headers->get('Cache-Control'), $label);
        $this->assertNull($response->headers->get('ETag'), "a 404 carries no validator: {$label}");
        $this->assertSame('not_found', $response->json('error.code'), $label);
    }

    /** A value image saved through the API and served once (200), as the starting point of N1–N8. */
    private function servedValueImage(array $store, string $valueSlug = 'birthday'): array
    {
        $mediaId = $this->uploadMedia($store);
        $version = $this->putValueVisual($store, $valueSlug, ['image' => ['mediaId' => $mediaId], 'shape' => 'arch'], null);
        $visualId = $this->visualRow($store, $valueSlug)->id;
        $ok = $this->image($store, $visualId, $mediaId)->assertOk();

        return ['mediaId' => $mediaId, 'visualId' => $visualId, 'version' => $version, 'etag' => (string) $ok->headers->get('ETag')];
    }

    // ═════════════════ projection contract (D1, D2) ═════════════════

    /** @test */
    public function meta_facets_carry_the_normalized_documents_with_public_sources_only(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-shape');
        $valueMedia = $this->uploadMedia($store);
        $facetMedia = $this->uploadMedia($store);
        $this->putValueVisual($store, 'birthday', [
            'image' => ['mediaId' => $valueMedia, 'focal' => ['x' => 30, 'y' => 40], 'zoom' => 1.5],
            'shape' => 'arch',
        ], null);
        $this->putFacetVisual($store, [
            'self' => ['image' => ['mediaId' => $facetMedia], 'icon' => 'gift'],
            'defaults' => ['shape' => 'rounded', 'size' => 'lg', 'icon' => 'gift'],
        ], null);
        $valueRow = $this->visualRow($store, 'birthday');
        $facetRow = $this->visualRow($store, null);

        $response = $this->products($store);
        $facet = $this->metaFacet($response);
        $birthday = $this->metaValue($response, 'birthday');

        // D1 — not resolved: the value carries only its own keys; the facet carries {self, defaults}.
        $this->assertSame(['image', 'shape'], array_keys($birthday['visual']), json_encode($birthday['visual']));
        $this->assertSame('arch', $birthday['visual']['shape']);
        $this->assertSame(['mediaId', 'focal', 'zoom', 'sources'], array_keys($birthday['visual']['image']), json_encode($birthday['visual']['image']));
        $this->assertSame(['self', 'defaults'], array_keys($facet['visual']));
        $this->assertSame(['icon' => 'gift', 'shape' => 'rounded', 'size' => 'lg'], $facet['visual']['defaults'], 'canonical VD-1a key order');
        $this->assertNull($this->metaValue($response, 'wedding')['visual'], 'no row → null');

        // Sources: allowed files only, existing variants only, all under the guarded route of their own row.
        foreach ([[$birthday['visual']['image'], $valueRow->id, $valueMedia], [$facet['visual']['self']['image'], $facetRow->id, $facetMedia]] as [$image, $visualId, $mediaId]) {
            $this->assertNotEmpty($image['sources']);
            foreach ($image['sources'] as $source) {
                $this->assertSame(['width', 'format', 'src'], array_keys($source));
                $this->assertContains($source['format'], ['webp', 'jpg']);
                $this->assertMatchesRegularExpression(
                    '#\A/store/v1/media/facet-visuals/'.$visualId.'/'.$mediaId.'/(thumb-160|thumb-320|480w|768w)\.(webp|jpg)\z#',
                    $source['src'],
                );
                $file = basename($source['src']);
                $this->image($store, $visualId, $mediaId, $file)->assertOk();
            }
        }

        // Unchanged shape for everything that was already there (additive only).
        $this->assertSame(['key', 'system_key', 'name', 'name_en', 'values', 'visual'], array_keys($facet));
        $this->assertSame(['slug', 'name', 'name_en', 'count', 'selected', 'visual'], array_keys($birthday));
    }

    /** @test */
    public function an_image_whose_media_is_not_usable_is_left_out_of_the_document(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-unusable');
        $mediaId = $this->uploadMedia($store);
        $this->putValueVisual($store, 'birthday', ['image' => ['mediaId' => $mediaId], 'icon' => 'cake'], null);
        $this->putValueVisual($store, 'wedding', ['image' => ['mediaId' => $mediaId]], null);

        // The write path refuses unusable media (422), so the media degrades after the save.
        StorefrontMedia::withoutGlobalScopes()->whereKey($mediaId)->update(['variants_state' => 'failed']);
        $birthday = $this->metaValue($this->products($store), 'birthday');
        $this->assertSame(['icon' => 'cake'], $birthday['visual'], 'image removed, the rest kept: the storefront falls back to the icon');

        // Only an image: the document becomes empty → null.
        $this->assertNull($this->metaValue($this->products($store), 'wedding')['visual']);
    }

    /** @test */
    public function legacy_routes_without_a_storefront_context_emit_visual_null(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-legacy');
        $mediaId = $this->uploadMedia($store);
        $this->putValueVisual($store, 'birthday', ['image' => ['mediaId' => $mediaId], 'shape' => 'arch'], null);
        $this->putFacetVisual($store, ['defaults' => ['shape' => 'rounded']], null);
        $slug = Tenant::findOrFail($store['tenant_id'])->slug;

        $response = $this->getJson("/store/v1/{$slug}/products")->assertOk();
        $facet = $this->metaFacet($response);
        $this->assertArrayHasKey('visual', $facet);
        $this->assertNull($facet['visual']);
        foreach ($facet['values'] as $value) {
            $this->assertArrayHasKey('visual', $value);
            $this->assertNull($value['visual']);
        }
        $this->assertStringNotContainsString('facet-visuals', $response->getContent());

        // The image route is not registered under the legacy prefix.
        $visualId = $this->visualRow($store, 'birthday')->id;
        $this->getJson("/store/v1/{$slug}/media/facet-visuals/{$visualId}/{$mediaId}/480w.webp")->assertNotFound();
    }

    /** @test */
    public function the_projection_is_two_bounded_queries_whatever_the_number_of_values(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-queries');
        foreach (['birthday', 'wedding'] as $slug) {
            $this->putValueVisual($store, $slug, ['image' => ['mediaId' => $this->uploadMedia($store)]], null);
        }
        $this->putFacetVisual($store, ['self' => ['image' => ['mediaId' => $this->uploadMedia($store)]]], null);

        DB::enableQueryLog();
        $this->products($store);
        $queries = collect(DB::getQueryLog())->pluck('query');
        DB::disableQueryLog();

        $this->assertCount(1, $queries->filter(fn (string $q) => str_contains($q, 'commerce_facet_visuals')));
        $this->assertCount(1, $queries->filter(fn (string $q) => str_contains($q, 'from "storefront_media"')));
    }

    // ═════════════════ N1–N19 (§3.8-f) ═════════════════

    /** @test */
    public function n1_disabling_the_value_after_a_successful_serve_is_an_immediate_404_and_drops_it_from_meta(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n1');
        $served = $this->servedValueImage($store);

        CommerceFacetValue::withoutGlobalScopes()->whereKey($store['values']['birthday']->id)->update(['is_active' => false]);

        $this->assertUniform404($this->image($store, $served['visualId'], $served['mediaId']), 'N1');
        $this->assertNull($this->metaValue($this->products($store), 'birthday'), 'the same request cycle no longer lists it');
    }

    /** @test */
    public function n2_disabling_the_facet_404s_value_and_facet_images_and_drops_the_facet_from_meta(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n2');
        $served = $this->servedValueImage($store);
        $facetMedia = $this->uploadMedia($store);
        $this->putFacetVisual($store, ['self' => ['image' => ['mediaId' => $facetMedia]]], null);
        $facetVisualId = $this->visualRow($store, null)->id;
        $this->image($store, $facetVisualId, $facetMedia)->assertOk();

        CommerceFacet::withoutGlobalScopes()->whereKey($store['facet']->id)->update(['is_active' => false]);

        $this->assertUniform404($this->image($store, $served['visualId'], $served['mediaId']), 'N2 value');
        $this->assertUniform404($this->image($store, $facetVisualId, $facetMedia), 'N2 facet');
        $this->assertNull($this->metaFacet($this->products($store)));
    }

    /** @test */
    public function n3_deleting_the_value_or_the_facet_through_the_cascade_is_a_404(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n3');
        $value = $this->servedValueImage($store, 'birthday');
        $other = $this->servedValueImage($store, 'wedding');

        CommerceProductFacetValue::withoutGlobalScopes()->where('commerce_facet_value_id', $store['values']['birthday']->id)->delete();
        CommerceFacetValue::withoutGlobalScopes()->whereKey($store['values']['birthday']->id)->delete();
        $this->assertUniform404($this->image($store, $value['visualId'], $value['mediaId']), 'N3 value');
        $this->image($store, $other['visualId'], $other['mediaId'])->assertOk();

        CommerceProductFacetValue::withoutGlobalScopes()->whereIn('commerce_facet_value_id', collect($store['values'])->pluck('id'))->delete();
        CommerceFacetValue::withoutGlobalScopes()->where('commerce_facet_id', $store['facet']->id)->delete();
        CommerceFacet::withoutGlobalScopes()->whereKey($store['facet']->id)->delete();
        $this->assertSame(0, CommerceFacetVisual::withoutGlobalScopes()->count(), 'rows go with their owner');
        $this->assertUniform404($this->image($store, $other['visualId'], $other['mediaId']), 'N3 facet');
    }

    /** @test */
    public function n4_removing_the_identity_404s_the_old_url(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n4');
        $served = $this->servedValueImage($store);

        $this->putValueVisual($store, 'birthday', null, $served['version']);

        $this->assertUniform404($this->image($store, $served['visualId'], $served['mediaId']), 'N4');
        $this->assertNull($this->metaValue($this->products($store), 'birthday')['visual']);
    }

    /** @test */
    public function n5_replacing_the_image_changes_the_url_and_the_etag_and_404s_the_old_one(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n5');
        $served = $this->servedValueImage($store);
        $newMedia = $this->uploadMedia($store);

        $this->putValueVisual($store, 'birthday', ['image' => ['mediaId' => $newMedia], 'shape' => 'arch'], $served['version']);

        $this->assertUniform404($this->image($store, $served['visualId'], $served['mediaId']), 'N5 old');
        $sources = $this->metaValue($this->products($store), 'birthday')['visual']['image']['sources'];
        $this->assertStringContainsString("/{$newMedia}/", $sources[0]['src'], 'meta carries the new URL at once');
        $new = $this->image($store, $served['visualId'], $newMedia)->assertOk();
        $this->assertNotSame($served['etag'], (string) $new->headers->get('ETag'));
    }

    /** @test */
    public function n6_changing_only_the_framing_keeps_the_url_and_bytes_and_updates_meta_at_once(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n6');
        $served = $this->servedValueImage($store);

        $this->putValueVisual($store, 'birthday', [
            'image' => ['mediaId' => $served['mediaId'], 'focal' => ['x' => 10, 'y' => 90], 'zoom' => 2, 'fit' => 'contain'],
            'shape' => 'arch',
        ], $served['version']);

        $again = $this->image($store, $served['visualId'], $served['mediaId'])->assertOk();
        $this->assertSame($served['etag'], (string) $again->headers->get('ETag'), 'framing is CSS, not pixels');
        $image = $this->metaValue($this->products($store), 'birthday')['visual']['image'];
        $this->assertSame(['x' => 10, 'y' => 90], $image['focal']);
        $this->assertSame(2, $image['zoom']);
        $this->assertSame('contain', $image['fit']);
    }

    /** @test */
    public function n7_a_valid_etag_after_disabling_is_a_404_never_a_304(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n7');
        $served = $this->servedValueImage($store);

        // Before: the revalidation is authorized and answers 304 without reading storage.
        $gets = count(array_filter($this->r2Calls, static fn (string $c): bool => str_starts_with($c, 'get:')));
        $this->image($store, $served['visualId'], $served['mediaId'], '480w.webp', ['If-None-Match' => $served['etag']])
            ->assertStatus(304)
            ->assertHeader('ETag', $served['etag']);
        $this->assertSame($gets, count(array_filter($this->r2Calls, static fn (string $c): bool => str_starts_with($c, 'get:'))));

        CommerceFacetValue::withoutGlobalScopes()->whereKey($store['values']['birthday']->id)->update(['is_active' => false]);

        $this->assertUniform404(
            $this->image($store, $served['visualId'], $served['mediaId'], '480w.webp', ['If-None-Match' => $served['etag']]),
            'N7',
        );
    }

    /** @test */
    public function n8_soft_deleted_or_not_ready_media_injected_in_the_database_is_a_404(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n8');
        $served = $this->servedValueImage($store);

        foreach (['pending', 'failed'] as $variantsState) {
            StorefrontMedia::withoutGlobalScopes()->whereKey($served['mediaId'])->update(['variants_state' => $variantsState]);
            $this->assertUniform404($this->image($store, $served['visualId'], $served['mediaId']), "N8 {$variantsState}");
        }
        StorefrontMedia::withoutGlobalScopes()->whereKey($served['mediaId'])->update(['variants_state' => 'ready', 'state' => 'deleted']);
        $this->assertUniform404($this->image($store, $served['visualId'], $served['mediaId']), 'N8 deleted');
        StorefrontMedia::withoutGlobalScopes()->whereKey($served['mediaId'])->update(['state' => 'purged']);
        $this->assertUniform404($this->image($store, $served['visualId'], $served['mediaId']), 'N8 purged');
    }

    /** @test */
    public function n9_another_tenants_visual_row_is_a_404_identical_to_a_missing_row(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n9');
        $other = $this->store('vd1c-n9-b');
        $foreign = $this->servedValueImage($other);

        $requestId = ['X-Request-Id' => 'vd1c-n9-fixed'];
        $foreignResponse = $this->image($store, $foreign['visualId'], $foreign['mediaId'], '480w.webp', $requestId);
        $missingResponse = $this->image($store, (string) Str::uuid(), $foreign['mediaId'], '480w.webp', $requestId);
        $this->assertUniform404($foreignResponse, 'N9 foreign');
        $this->assertUniform404($missingResponse, 'N9 missing');

        $strip = static function (TestResponse $r): array {
            $body = $r->json();
            unset($body['meta']['request_id']); // per request unless the header is honoured

            return $body;
        };
        $this->assertSame($strip($missingResponse), $strip($foreignResponse));
        $headers = static function (TestResponse $r): array {
            $all = $r->headers->all();
            unset($all['date'], $all['x-request-id'], $all['set-cookie']);
            foreach (array_keys($all) as $name) {
                if (str_starts_with($name, 'x-ratelimit')) {
                    unset($all[$name]);
                }
            }
            ksort($all);

            return $all;
        };
        $this->assertSame($headers($missingResponse), $headers($foreignResponse));

        // It still serves on its own host.
        $this->image($other, $foreign['visualId'], $foreign['mediaId'])->assertOk();
    }

    /** @test */
    public function n10_a_foreign_media_id_injected_into_the_document_is_a_404(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n10');
        $other = $this->store('vd1c-n10-b');
        $foreignMedia = $this->uploadMedia($other);
        $served = $this->servedValueImage($store);

        // Bypass the write path (which refuses a foreign id with media_not_found) and inject it directly.
        CommerceFacetVisual::withoutGlobalScopes()->whereKey($served['visualId'])
            ->update(['visual' => json_encode(['image' => ['mediaId' => $foreignMedia]])]);

        $this->assertUniform404($this->image($store, $served['visualId'], $foreignMedia), 'N10 serve');
        foreach (['480w.webp', 'thumb-160.jpg', '768w.jpg'] as $file) {
            $this->assertUniform404($this->image($store, $served['visualId'], $foreignMedia, $file), "N10 {$file}");
        }
        $birthday = $this->metaValue($this->products($store), 'birthday');
        $this->assertNull($birthday['visual'], 'the projection never emits a source for media outside the tenant');
        $this->assertStringNotContainsString($foreignMedia, $this->products($store)->getContent());
    }

    /** @test */
    public function n11_a_tenant_media_id_not_referenced_by_this_identity_is_a_404(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n11');
        $served = $this->servedValueImage($store, 'birthday');
        $wedding = $this->servedValueImage($store, 'wedding');
        $unreferenced = $this->uploadMedia($store);

        $this->assertUniform404($this->image($store, $served['visualId'], $unreferenced), 'N11 library media');
        $this->assertUniform404($this->image($store, $served['visualId'], $wedding['mediaId']), 'N11 media of another row');
    }

    /** @test */
    public function n12_originals_traversal_other_extensions_and_widths_are_404s(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n12');
        $served = $this->servedValueImage($store);
        $base = "http://{$store['host']}/store/v1/media/facet-visuals";
        $v = $served['visualId'];
        $m = $served['mediaId'];

        foreach ([
            'original' => "{$base}/{$v}/{$m}/original.jpg",
            'original upload name' => "{$base}/{$v}/{$m}/photo.jpg",
            'other width' => "{$base}/{$v}/{$m}/1200w.webp",
            'generated but not public width' => "{$base}/{$v}/{$m}/320w.webp",
            'other extension' => "{$base}/{$v}/{$m}/480w.png",
            'uppercase extension' => "{$base}/{$v}/{$m}/480w.WEBP",
            'dot segment' => "{$base}/{$v}/{$m}/..",
            'traversal' => "{$base}/{$v}/../{$m}/480w.webp",
            'encoded traversal' => "{$base}/{$v}/{$m}/..%2F..%2Foriginal.jpg",
            // `%2F` is decoded before routing, so it only ever reaches the guards as the equivalent URL: it cannot
            // widen access (the proxy refuses it before the origin anyway).
            'encoded slash to the original' => "{$base}/{$v}%2F{$m}/original.jpg",
            'encoded slash to unreferenced media' => "{$base}/{$v}%2F".Str::uuid().'/480w.webp',
            'extra segment' => "{$base}/{$v}/{$m}/480w.webp/x",
            'missing segment' => "{$base}/{$v}/480w.webp",
            'prefix only' => $base,
            'not a uuid' => "{$base}/not-a-uuid/{$m}/480w.webp",
            'uppercase uuid' => "{$base}/".strtoupper($v)."/{$m}/480w.webp",
        ] as $label => $url) {
            $this->assertUniform404($this->get($url), "N12 {$label}");
        }

        // Control: the same row and media serve a public file.
        $this->image($store, $v, $m, '480w.webp')->assertOk();
    }

    /** @test */
    public function n13_every_404_of_the_route_carries_no_store_and_one_body(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n13');
        $served = $this->servedValueImage($store);
        $requestId = ['X-Request-Id' => 'vd1c-n13-fixed'];

        $bodies = [];
        foreach ([
            'unknown row' => [(string) Str::uuid(), $served['mediaId'], '480w.webp'],
            'unknown media' => [$served['visualId'], (string) Str::uuid(), '480w.webp'],
            'bad file' => [$served['visualId'], $served['mediaId'], 'original.jpg'],
            'bad id' => ['x', $served['mediaId'], '480w.webp'],
        ] as $label => [$visualId, $mediaId, $file]) {
            $response = $this->image($store, $visualId, $mediaId, $file, $requestId);
            $this->assertUniform404($response, "N13 {$label}");
            $body = $response->json();
            unset($body['meta']['request_id']);
            $bodies[$label] = json_encode($body);
        }
        $this->assertCount(1, array_unique($bodies), json_encode($bodies));

        // HEAD answers the same way.
        $head = $this->call('HEAD', "http://{$store['host']}/store/v1/media/facet-visuals/".Str::uuid()."/{$served['mediaId']}/480w.webp");
        $this->assertSame(404, $head->getStatusCode());
        $this->assertStringContainsString('no-store', (string) $head->headers->get('Cache-Control'));
    }

    /** @test */
    public function n15_meta_facets_never_contain_an_original_or_the_admin_signed_preview(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n15');
        $mediaId = $this->uploadMedia($store);
        $this->putValueVisual($store, 'birthday', ['image' => ['mediaId' => $mediaId]], null);
        $this->putFacetVisual($store, ['self' => ['image' => ['mediaId' => $mediaId]]], null);

        $content = $this->products($store)->getContent();
        foreach (['original', 'signature=', 'expires=', 'visual_preview', 'visual_version', 'storage_key', 'storefront-media', '/api/commerce'] as $needle) {
            $this->assertStringNotContainsString($needle, $content, "leaked: {$needle}");
        }
        preg_match_all('#"src":"([^"]+)"#', $content, $srcs);
        $this->assertNotEmpty($srcs[1]);
        foreach ($srcs[1] as $src) {
            $this->assertStringStartsWith('/store/v1/media/facet-visuals/', stripslashes($src));
        }
    }

    /** @test */
    public function n16_commerce_v1_products_carry_no_visual_and_keep_their_closed_contract(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n16');
        $mediaId = $this->uploadMedia($store);
        $this->putValueVisual($store, 'birthday', ['image' => ['mediaId' => $mediaId], 'shape' => 'arch'], null);
        $this->putFacetVisual($store, ['defaults' => ['shape' => 'rounded']], null);

        app(TenantContext::class)->set($store['tenant_id']);
        $mobile = SalesChannel::create(['slug' => 'mobile', 'name' => 'جوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        CommerceListing::create(['product_id' => $store['product']->id, 'sales_channel_id' => $mobile->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        $service = app(ApiClientKeyService::class);
        $client = $service->createClient(Tenant::findOrFail($store['tenant_id']), 'mobile-app', true);
        $key = $service->issueKey($client, 'default', [])->plainTextToken;

        $response = $this->getJson('/commerce/v1/products', ['Authorization' => 'Bearer '.$key])->assertOk();
        $facet = collect($response->json('meta.facets'))->firstWhere('key', 'occasion');
        $this->assertNotNull($facet);
        $this->assertSame(['key', 'system_key', 'name', 'name_en', 'values'], array_keys($facet));
        foreach ($facet['values'] as $value) {
            $this->assertSame(['slug', 'name', 'name_en', 'count', 'selected'], array_keys($value));
        }
        $this->assertStringNotContainsString('facet-visuals', $response->getContent());
        $this->assertStringNotContainsString($mediaId, $response->getContent());
    }

    /** @test */
    public function n17_a_value_visible_only_on_store_a_is_absent_and_404_through_store_b_of_the_same_tenant(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n17');
        $served = $this->servedValueImage($store);

        // Store B: same tenant, its own channel and host; the product is not published there.
        app(TenantContext::class)->set($store['tenant_id']);
        $channelB = SalesChannel::create(['slug' => 'web-b', 'name' => 'ويب ب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefrontB = Storefront::create(['slug' => 'b', 'name' => 'متجر ب', 'sales_channel_id' => $channelB->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefrontB->id, 'hostname' => 'vd1c-n17-b.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        // B lists another product that has the facet but not this value, so the facet itself shows on B.
        $productB = $this->product($channelB);
        CommerceProductFacetValue::create(['product_id' => $productB->id, 'commerce_facet_value_id' => $store['values']['wedding']->id]);
        app(TenantContext::class)->forget();
        $storeB = ['host' => 'vd1c-n17-b.example.com'] + $store;

        $this->assertUniform404($this->image($storeB, $served['visualId'], $served['mediaId']), 'N17 via B');
        $metaB = $this->products($storeB);
        $this->assertNull($this->metaValue($metaB, 'birthday'), 'B does not list the value');
        $this->assertStringNotContainsString($served['visualId'], $metaB->getContent());

        // And A still serves it.
        $this->image($store, $served['visualId'], $served['mediaId'])->assertOk();
    }

    /** @test */
    public function n18_unpublishing_or_deactivating_the_only_product_is_an_immediate_404(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n18');
        $served = $this->servedValueImage($store);

        CommerceListing::withoutGlobalScopes()->where('product_id', $store['product']->id)->update(['is_published' => false]);
        $this->assertUniform404($this->image($store, $served['visualId'], $served['mediaId']), 'N18 unpublished');

        CommerceListing::withoutGlobalScopes()->where('product_id', $store['product']->id)->update(['is_published' => true]);
        $this->image($store, $served['visualId'], $served['mediaId'])->assertOk();

        Product::withoutGlobalScopes()->whereKey($store['product']->id)->update(['is_active' => false]);
        $this->assertUniform404($this->image($store, $served['visualId'], $served['mediaId']), 'N18 inactive product');
    }

    /** @test */
    public function n19_a_facet_image_whose_values_have_no_visible_product_on_the_channel_is_a_404(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-n19');
        $facetMedia = $this->uploadMedia($store);
        $this->putFacetVisual($store, ['self' => ['image' => ['mediaId' => $facetMedia]]], null);
        $facetVisualId = $this->visualRow($store, null)->id;
        $this->image($store, $facetVisualId, $facetMedia)->assertOk();

        // A value with no product («party») never makes the facet visible.
        // The only product moves off birthday/wedding: no active value of the facet has a visible product left.
        CommerceProductFacetValue::withoutGlobalScopes()->where('product_id', $store['product']->id)->delete();
        $this->assertUniform404($this->image($store, $facetVisualId, $facetMedia), 'N19 no products');

        // A product assigned only to an inactive value does not count either.
        app(TenantContext::class)->set($store['tenant_id']);
        CommerceProductFacetValue::create(['product_id' => $store['product']->id, 'commerce_facet_value_id' => $store['values']['party']->id]);
        app(TenantContext::class)->forget();
        CommerceFacetValue::withoutGlobalScopes()->whereKey($store['values']['party']->id)->update(['is_active' => false]);
        $this->assertUniform404($this->image($store, $facetVisualId, $facetMedia), 'N19 inactive value');

        CommerceFacetValue::withoutGlobalScopes()->whereKey($store['values']['party']->id)->update(['is_active' => true]);
        $this->image($store, $facetVisualId, $facetMedia)->assertOk();
    }

    // ═════════════════ success headers ═════════════════

    /** @test */
    public function a_served_image_is_private_no_store_with_a_content_etag_and_nosniff(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('vd1c-ok');
        $served = $this->servedValueImage($store);

        $webp = $this->image($store, $served['visualId'], $served['mediaId'], '768w.webp')->assertOk();
        $webp->assertHeader('Content-Type', 'image/webp');
        $webp->assertHeader('X-Content-Type-Options', 'nosniff');
        $cache = (string) $webp->headers->get('Cache-Control');
        $this->assertStringContainsString('no-store', $cache);
        $this->assertStringContainsString('private', $cache);
        $this->assertStringNotContainsString('public', $cache, 'the origin is never shared-cacheable (AMEND-16)');
        $this->assertStringStartsWith('RIFF', (string) $webp->streamedContent());

        $this->image($store, $served['visualId'], $served['mediaId'], 'thumb-160.jpg')->assertOk()->assertHeader('Content-Type', 'image/jpeg');
        $this->assertSame(
            StorefrontFacetVisualProjector::FILES,
            ['thumb-160.webp', 'thumb-160.jpg', 'thumb-320.webp', 'thumb-320.jpg', '480w.webp', '480w.jpg', '768w.webp', '768w.jpg'],
        );

        // An unknown host resolves no storefront at all.
        $this->get("http://unknown.example.com/store/v1/media/facet-visuals/{$served['visualId']}/{$served['mediaId']}/480w.webp")->assertNotFound();
    }
}
