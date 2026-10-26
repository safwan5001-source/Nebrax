<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\StorefrontPresentation;
use App\Support\Commerce\PublishedPolicyContent;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * X4-FIX — `policy_availability` in `GET store/v1/storefront`: slug ⇒ bool, computed from the PUBLISHED snapshot
 * with the same rules as `GET store/v1/policies/{slug}`. Booleans only; fails closed; tenant/storefront isolated.
 *
 * تشغيل: php artisan test --filter=StorefrontPolicyAvailabilityTest
 */
class StorefrontPolicyAvailabilityTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const SLUGS = ['shipping-policy', 'privacy-policy', 'returns-policy', 'terms-of-service'];

    private function ws(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    /** @return array{storefront: Storefront} */
    private function seedStore(string $tenantId, string $host, string $slug = 'main'): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create([
            'slug' => $slug, 'name' => 'متجر '.$slug, 'sales_channel_id' => $channel->id,
            'is_active' => true, 'default_locale' => 'ar',
        ]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => true, 'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('storefront');
    }

    /** @param array<string, mixed> $content */
    private function page(string $slug, array $content = [], bool $enabled = true): array
    {
        $page = ['id' => 'p-'.$slug, 'slug' => $slug, 'title' => 'عنوان قديم', 'enabled' => $enabled];
        if ($content !== []) {
            $page['content'] = $content;
        }

        return $page;
    }

    private function revision(array $auth, Storefront $sf): int
    {
        return (int) $this->withToken($auth['token'])->getJson($this->ws($sf->id))->json('data.draft_revision');
    }

    private function save(array $auth, Storefront $sf, array $pages, bool $publish = true): void
    {
        $this->withToken($auth['token'])
            ->putJson($this->ws($sf->id), ['config' => ['pages' => $pages], 'draft_revision' => $this->revision($auth, $sf)])
            ->assertOk();
        if ($publish) {
            $this->withToken($auth['token'])->postJson($this->ws($sf->id).'/publish')->assertOk();
        }
    }

    /** @return array<string, mixed> */
    private function availability(string $host): array
    {
        return $this->getJson("http://$host/store/v1/storefront")->assertOk()->json('data.policy_availability');
    }

    /** What the real policy endpoint says about every slug (the ground truth the signal must equal). */
    private function endpointTruth(string $host): array
    {
        $truth = [];
        foreach (self::SLUGS as $slug) {
            $truth[$slug] = $this->getJson("http://$host/store/v1/policies/$slug")->status() === 200;
        }

        return $truth;
    }

    private function assertMatchesEndpoint(string $host, array $expected): void
    {
        $signal = $this->availability($host);
        $this->assertSame(self::SLUGS, array_keys($signal));
        $this->assertSame($expected, $signal);
        $this->assertSame($expected, $this->endpointTruth($host), 'the signal must equal what the policy endpoint serves');
    }

    private function allFalse(): array
    {
        return array_fill_keys(self::SLUGS, false);
    }

    /** @test */
    public function enabled_policy_with_visible_published_content_is_available_and_the_page_serves_it(): void
    {
        $a = $this->registerTenant('av-vis', 'owner@av-vis.test');
        $s = $this->seedStore($a['tenant_id'], 'av-vis.example.com');
        $this->save($a, $s['storefront'], [
            $this->page('privacy-policy', ['ar' => ['title' => 'ع', 'body' => "## بيانات\n\nنحميها"]]),
            $this->page('terms-of-service', ['en' => ['title' => 'T', 'body' => 'Terms **apply**']]),
        ]);

        $this->assertMatchesEndpoint('av-vis.example.com', [
            'shipping-policy' => false,
            'privacy-policy' => true,
            'returns-policy' => false,
            'terms-of-service' => true,
        ]);
    }

    /** @test */
    public function empty_whitespace_image_only_and_markup_only_content_is_not_available(): void
    {
        $a = $this->registerTenant('av-empty', 'owner@av-empty.test');
        $s = $this->seedStore($a['tenant_id'], 'av-empty.example.com');
        $this->save($a, $s['storefront'], [
            $this->page('shipping-policy', ['ar' => ['title' => 'ع', 'body' => '![x](https://example.com/p.png)']]),
            $this->page('privacy-policy', ['ar' => ['title' => 'ع', 'body' => '   ']]),
            $this->page('returns-policy', ['ar' => ['title' => 'ع', 'body' => '<script>alert(1)</script>'], 'en' => ['title' => 't', 'body' => "---\n\n***"]]),
            $this->page('terms-of-service', ['ar' => ['title' => 'ع', 'body' => "## \n\n> \n\n- "]]),
        ]);

        $this->assertMatchesEndpoint('av-empty.example.com', $this->allFalse());
    }

    /** @test */
    public function draft_only_content_unpublished_documents_and_disabled_pages_are_not_available(): void
    {
        $a = $this->registerTenant('av-draft', 'owner@av-draft.test');
        $s = $this->seedStore($a['tenant_id'], 'av-draft.example.com');

        // Nothing published yet — a saved draft with content must not leak into availability.
        $this->save($a, $s['storefront'], [$this->page('privacy-policy', ['ar' => ['title' => 'ع', 'body' => 'مسودة سرية'], 'en' => ['title' => 't', 'body' => 'x']])], false);
        $this->assertMatchesEndpoint('av-draft.example.com', $this->allFalse());

        // Publish, then add content to ANOTHER policy in the draft only and disable one in the published doc.
        $this->save($a, $s['storefront'], [
            $this->page('privacy-policy', ['ar' => ['title' => 'ع', 'body' => 'منشور']]),
            $this->page('returns-policy', ['ar' => ['title' => 'ع', 'body' => 'معطّلة']], false),
        ]);
        $this->save($a, $s['storefront'], [
            $this->page('privacy-policy', ['ar' => ['title' => 'ع', 'body' => 'منشور']]),
            $this->page('returns-policy', ['ar' => ['title' => 'ع', 'body' => 'معطّلة']], false),
            $this->page('terms-of-service', ['ar' => ['title' => 'ع', 'body' => 'مسودة فقط']]),
        ], false);

        $this->assertMatchesEndpoint('av-draft.example.com', [
            'shipping-policy' => false,
            'privacy-policy' => true,
            'returns-policy' => false,
            'terms-of-service' => false,
        ]);
    }

    /** @test */
    public function legacy_documents_and_stores_without_a_published_presentation_fail_closed(): void
    {
        $a = $this->registerTenant('av-legacy', 'owner@av-legacy.test');
        $s = $this->seedStore($a['tenant_id'], 'av-legacy.example.com');

        // No presentation row at all.
        $this->assertMatchesEndpoint('av-legacy.example.com', $this->allFalse());
        $this->assertNull($this->getJson('http://av-legacy.example.com/store/v1/storefront')->json('data.presentation'));

        // A legacy published document: pages carry only {id, slug, title, enabled} (no content key) — all four enabled by default.
        $this->save($a, $s['storefront'], [
            ['id' => 'p1', 'slug' => 'privacy-policy', 'title' => 'الخصوصية', 'enabled' => true],
            ['id' => 'p2', 'slug' => 'returns-policy', 'title' => 'الإرجاع', 'enabled' => true],
        ]);
        $this->assertMatchesEndpoint('av-legacy.example.com', $this->allFalse());
    }

    /** @test */
    public function language_fallback_is_consistent_with_the_endpoint_in_both_directions(): void
    {
        $a = $this->registerTenant('av-loc', 'owner@av-loc.test');
        $s = $this->seedStore($a['tenant_id'], 'av-loc.example.com');
        $this->save($a, $s['storefront'], [
            $this->page('privacy-policy', ['en' => ['title' => 'P', 'body' => 'English only']]),
            $this->page('terms-of-service', ['ar' => ['title' => 'ش', 'body' => 'عربي فقط']]),
            $this->page('returns-policy', ['ar' => ['title' => 'ش', 'body' => '![x](https://e.com/p.png)'], 'en' => ['title' => 'R', 'body' => 'English wins']]),
        ]);

        $this->assertMatchesEndpoint('av-loc.example.com', [
            'shipping-policy' => false,
            'privacy-policy' => true,
            'returns-policy' => true,
            'terms-of-service' => true,
        ]);
        // …and the endpoint really does serve them in either requested language.
        foreach (['ar', 'en'] as $locale) {
            foreach (['privacy-policy', 'returns-policy', 'terms-of-service'] as $slug) {
                $this->getJson("http://av-loc.example.com/store/v1/policies/$slug?locale=$locale")->assertOk();
            }
        }
    }

    /** @test */
    public function availability_is_isolated_per_tenant_and_per_storefront_and_ignores_spoofed_identity(): void
    {
        $a = $this->registerTenant('av-iso-a', 'owner@av-iso-a.test');
        $b = $this->registerTenant('av-iso-b', 'owner@av-iso-b.test');
        $a1 = $this->seedStore($a['tenant_id'], 'av-iso-a1.example.com', 'one');
        $a2 = $this->seedStore($a['tenant_id'], 'av-iso-a2.example.com', 'two');
        $b1 = $this->seedStore($b['tenant_id'], 'av-iso-b1.example.com');
        $this->save($a, $a1['storefront'], [$this->page('privacy-policy', ['ar' => ['title' => 'ع', 'body' => 'A1 SECRET']])]);
        $this->save($b, $b1['storefront'], [$this->page('terms-of-service', ['ar' => ['title' => 'ع', 'body' => 'B1 SECRET']])]);

        $this->assertMatchesEndpoint('av-iso-a1.example.com', ['shipping-policy' => false, 'privacy-policy' => true, 'returns-policy' => false, 'terms-of-service' => false]);
        $this->assertMatchesEndpoint('av-iso-b1.example.com', ['shipping-policy' => false, 'privacy-policy' => false, 'returns-policy' => false, 'terms-of-service' => true]);
        $this->assertMatchesEndpoint('av-iso-a2.example.com', $this->allFalse()); // same tenant, other storefront

        $spoof = $this->withHeaders([
            'X-Forwarded-Host' => 'av-iso-a1.example.com', 'X-Tenant-ID' => $a['tenant_id'], 'X-Storefront-ID' => $a1['storefront']->id,
        ])->getJson('http://av-iso-b1.example.com/store/v1/storefront?tenant_id='.$a['tenant_id'].'&storefront_id='.$a1['storefront']->id);
        $spoof->assertOk();
        $this->assertFalse($spoof->json('data.policy_availability.privacy-policy'));
        $this->assertTrue($spoof->json('data.policy_availability.terms-of-service'));
    }

    /** @test */
    public function the_public_response_exposes_booleans_only_never_bodies_and_stored_documents_gain_no_key(): void
    {
        $a = $this->registerTenant('av-conf', 'owner@av-conf.test');
        $s = $this->seedStore($a['tenant_id'], 'av-conf.example.com');
        $this->save($a, $s['storefront'], [$this->page('privacy-policy', ['ar' => ['title' => 'عنوان سري', 'body' => 'BODY-AVAIL-1'], 'en' => ['title' => 'T', 'body' => 'BODY-AVAIL-2']])]);

        $res = $this->getJson('http://av-conf.example.com/store/v1/storefront')->assertOk();
        $this->assertStringNotContainsString('BODY-AVAIL', $res->getContent());
        $this->assertStringNotContainsString('عنوان سري', $res->getContent());
        foreach ($res->json('data.policy_availability') as $value) {
            $this->assertIsBool($value);
        }
        $this->assertArrayNotHasKey('content', $res->json('data.presentation.pages.0'));
        // Backward compatible: every pre-existing key is still there.
        foreach (['name', 'default_locale', 'business_vertical', 'business_identity', 'presentation', 'presentation_media'] as $key) {
            $this->assertArrayHasKey($key, $res->json('data'));
        }

        // Persisted documents are untouched: no availability key anywhere in the stored configs.
        app(TenantContext::class)->set($a['tenant_id']);
        $row = StorefrontPresentation::query()->where('storefront_id', $s['storefront']->id)->firstOrFail();
        app(TenantContext::class)->forget();
        foreach ([$row->draft_config, $row->published_config] as $document) {
            $this->assertStringNotContainsString('policy_availability', json_encode($document));
            $this->assertStringNotContainsString('available', json_encode($document));
        }
        $this->assertSame(0, DB::table('storefront_presentation_versions')->where('config', 'like', '%policy_availability%')->count());
    }

    /** @test */
    public function the_shared_rules_class_is_pure_and_tolerates_junk_snapshots(): void
    {
        $this->assertSame(array_fill_keys(StorefrontPresentationNormalizer::POLICY_PAGE_SLUGS, false), PublishedPolicyContent::availability(null));
        $this->assertSame(array_fill_keys(StorefrontPresentationNormalizer::POLICY_PAGE_SLUGS, false), PublishedPolicyContent::availability(['pages' => 'nope']));
        $this->assertSame(array_fill_keys(StorefrontPresentationNormalizer::POLICY_PAGE_SLUGS, false), PublishedPolicyContent::availability(['pages' => [null, 5, ['slug' => 'privacy-policy', 'enabled' => 'yes', 'content' => ['ar' => ['body' => 'x']]]]]));
        $this->assertTrue(PublishedPolicyContent::availability(['pages' => [['slug' => 'privacy-policy', 'enabled' => true, 'content' => ['en' => ['body' => 'x']]]]])['privacy-policy']);
        $this->assertNull(PublishedPolicyContent::visibleHtml(['body' => 5]));
        $this->assertNull(PublishedPolicyContent::visibleHtml('x'));
    }
}
