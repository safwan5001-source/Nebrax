<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\StorefrontPresentation;
use App\Models\Tenant;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * STORE-BACKEND-1 — التشغيل العام يقرأ المنشورة فقط.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationPublicRuntimeTest
 */
class StorefrontPresentationPublicRuntimeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function workspacePath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    /**
     * @return array{channel: SalesChannel, storefront: Storefront, domain: StorefrontDomain}
     */
    private function seedPublicStore(string $tenantId, string $hostname, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create([
                'slug' => 'web',
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => true,
            ]);

        $storefront = Storefront::create([
            'slug' => $overrides['slug'] ?? 'main',
            'name' => $overrides['name'] ?? 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
            'default_locale' => $overrides['default_locale'] ?? 'ar',
        ]);

        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront', 'domain');
    }

    /** @test */
    public function public_runtime_is_null_when_nothing_is_published(): void
    {
        $auth = $this->registerTenant('pres-pub-null', 'owner@pres-pub-null.test');
        $seeded = $this->seedPublicStore($auth['tenant_id'], 'never-published.example.com');

        $res = $this->getJson('http://never-published.example.com/store/v1/storefront')->assertOk();

        $this->assertSame('المتجر الرئيسي', $res->json('data.name'));
        $this->assertSame('ar', $res->json('data.default_locale'));
        $this->assertNull($res->json('data.presentation'));
        $this->assertArrayNotHasKey('tenant_id', $res->json('data'));
        $this->assertArrayNotHasKey('draft', $res->json('data'));
    }

    /** @test */
    public function public_runtime_never_exposes_an_unpublished_draft(): void
    {
        $auth = $this->registerTenant('pres-pub-secret', 'owner@pres-pub-secret.test');
        $seeded = $this->seedPublicStore($auth['tenant_id'], 'draft-secret.example.com');

        $secret = 'مسودة سرية فريدة-'.uniqid();
        $this->withToken($auth['token'])
            ->putJson($this->workspacePath($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => $secret]],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $res = $this->getJson('http://draft-secret.example.com/store/v1/storefront')->assertOk();

        $this->assertNull($res->json('data.presentation'));
        $this->assertStringNotContainsString($secret, (string) $res->getContent());
    }

    /** @test */
    public function after_publish_the_next_public_get_sees_the_snapshot_without_a_restart(): void
    {
        $auth = $this->registerTenant('pres-pub-live', 'owner@pres-pub-live.test');
        $seeded = $this->seedPublicStore($auth['tenant_id'], 'published-live.example.com');
        Tenant::query()->whereKey($auth['tenant_id'])->update([
            'cr_number' => 'canonical-cr',
            'vat_number' => 'canonical-vat',
        ]);

        $this->withToken($auth['token'])
            ->putJson($this->workspacePath($seeded['storefront']->id), [
                'config' => [
                    'themePreset' => 'navy',
                    'homepage' => ['heroHeadline' => 'الحي بعد النشر'],
                    'verification' => [
                        'crNumber' => '1010101010',
                        'requestedVerifiedLabel' => true,
                    ],
                ],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $this->getJson('http://published-live.example.com/store/v1/storefront')
            ->assertOk()
            ->assertJsonPath('data.presentation', null);

        $this->withToken($auth['token'])
            ->postJson($this->workspacePath($seeded['storefront']->id).'/publish', ['draft_revision' => 1])
            ->assertOk();

        DB::enableQueryLog();
        $res = $this->getJson('http://published-live.example.com/store/v1/storefront')->assertOk();
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertSame('navy', $res->json('data.presentation.themePreset'));
        $this->assertSame('الحي بعد النشر', $res->json('data.presentation.homepage.heroHeadline'));
        $this->assertFalse($res->json('data.presentation.verification.requestedVerifiedLabel'));
        $this->assertSame('1010101010', $res->json('data.presentation.verification.crNumber'));
        $this->assertArrayNotHasKey('is_verified', $res->json('data.presentation'));
        $this->assertArrayNotHasKey('cr_number', $res->json('data'));
        $this->assertArrayNotHasKey('vat_number', $res->json('data'));
        $this->assertSame('canonical-cr', Tenant::query()->findOrFail($auth['tenant_id'])->cr_number);
        $this->assertSame('canonical-vat', Tenant::query()->findOrFail($auth['tenant_id'])->vat_number);
        $this->assertSame('المتجر الرئيسي', $res->json('data.name'));

        foreach ($queries as $query) {
            $this->assertStringNotContainsString('draft_config', $query['query']);
        }
    }

    /** @test */
    public function host_isolation_never_returns_another_tenants_published_presentation(): void
    {
        $a = $this->registerTenant('pres-host-a', 'owner@pres-host-a.test');
        $b = $this->registerTenant('pres-host-b', 'owner@pres-host-b.test');
        $storeA = $this->seedPublicStore($a['tenant_id'], 'host-a.example.com', ['name' => 'متجر ألف']);
        $storeB = $this->seedPublicStore($b['tenant_id'], 'host-b.example.com', ['name' => 'متجر باء']);

        $this->withToken($a['token'])
            ->putJson($this->workspacePath($storeA['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'ألف فقط']],
                'draft_revision' => 0,
            ])
            ->assertOk();
        $this->withToken($a['token'])
            ->postJson($this->workspacePath($storeA['storefront']->id).'/publish')
            ->assertOk();

        $this->withToken($b['token'])
            ->putJson($this->workspacePath($storeB['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'باء فقط']],
                'draft_revision' => 0,
            ])
            ->assertOk();
        $this->withToken($b['token'])
            ->postJson($this->workspacePath($storeB['storefront']->id).'/publish')
            ->assertOk();

        $resA = $this->getJson('http://host-a.example.com/store/v1/storefront')->assertOk();
        $resB = $this->getJson('http://host-b.example.com/store/v1/storefront')->assertOk();

        $this->assertSame('ألف فقط', $resA->json('data.presentation.homepage.heroHeadline'));
        $this->assertSame('باء فقط', $resB->json('data.presentation.homepage.heroHeadline'));
        $this->assertSame('متجر ألف', $resA->json('data.name'));
        $this->assertSame('متجر باء', $resB->json('data.name'));
    }

    /** @test */
    public function anonymous_workspace_draft_routes_are_unreachable(): void
    {
        $auth = $this->registerTenant('pres-anon-ws', 'owner@pres-anon-ws.test');
        $seeded = $this->seedPublicStore($auth['tenant_id'], 'anon-ws.example.com');

        $this->getJson($this->workspacePath($seeded['storefront']->id))->assertUnauthorized();
        $this->getJson('http://anon-ws.example.com'.$this->workspacePath($seeded['storefront']->id))
            ->assertUnauthorized();
    }

    /** @test */
    public function contract2_a_legacy_v1_published_snapshot_still_renders_publicly(): void
    {
        $auth = $this->registerTenant('pres-c2-legacy-pub', 'owner@pres-c2-legacy-pub.test');
        $seeded = $this->seedPublicStore($auth['tenant_id'], 'legacy-published.example.com');

        // صف محفوظ قبل CONTRACT-2: schema_version = 1 وأقسام بشكل {key, visible}.
        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontPresentation::create([
            'storefront_id' => $seeded['storefront']->id,
            'schema_version' => 1,
            'draft_config' => ['version' => 1],
            'draft_revision' => 1,
            'published_config' => [
                'version' => 1,
                'themePreset' => 'navy',
                'homepage' => [
                    'heroHeadline' => 'منشور قديم',
                    'sections' => [
                        ['key' => 'hero', 'visible' => true],
                        ['key' => 'banner', 'visible' => true],
                    ],
                ],
            ],
            'published_revision' => 1,
            'published_at' => now(),
        ]);
        app(TenantContext::class)->forget();

        $res = $this->getJson('http://legacy-published.example.com/store/v1/storefront')->assertOk();

        $this->assertSame('منشور قديم', $res->json('data.presentation.homepage.heroHeadline'));
        $sections = $res->json('data.presentation.homepage.sections');
        // الترحيل deterministic: id = key، ودلالات v1 تُلحق الأقسام الناقصة.
        $this->assertSame('hero', $sections[0]['id']);
        $this->assertSame('hero', $sections[0]['type']);
        $this->assertSame('banner', $sections[1]['id']);
        $this->assertCount(10, $sections);
        foreach ($sections as $section) {
            $this->assertSame($section['id'], $section['type']);
            $this->assertArrayNotHasKey('key', $section);
        }
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, $res->json('data.presentation.version'));
    }

    /** @test */
    public function contract2_a_v2_published_snapshot_keeps_instance_order_publicly(): void
    {
        $auth = $this->registerTenant('pres-c2-v2-pub', 'owner@pres-c2-v2-pub.test');
        $seeded = $this->seedPublicStore($auth['tenant_id'], 'v2-published.example.com');

        $sections = [
            ['id' => 'banner-a', 'type' => 'banner', 'visible' => true],
            ['id' => 'hero', 'type' => 'hero', 'visible' => true],
            ['id' => 'banner-b', 'type' => 'banner', 'visible' => false],
        ];

        $this->withToken($auth['token'])
            ->putJson($this->workspacePath($seeded['storefront']->id), [
                'config' => ['version' => 2, 'homepage' => ['sections' => $sections]],
                'draft_revision' => 0,
            ])
            ->assertOk();
        $this->withToken($auth['token'])
            ->postJson($this->workspacePath($seeded['storefront']->id).'/publish', ['draft_revision' => 1])
            ->assertOk();

        $res = $this->getJson('http://v2-published.example.com/store/v1/storefront')->assertOk();

        // الغياب = حذف: لا إحياء للأقسام غير الموجودة في اللقطة المنشورة.
        $this->assertSame($sections, $res->json('data.presentation.homepage.sections'));
    }
}
