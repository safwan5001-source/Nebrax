<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\StorefrontPresentation;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STORE-BACKEND-1 — GET/PUT مسودة المظهر.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationDraftApiTest
 */
class StorefrontPresentationDraftApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function path(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    /**
     * @return array{channel: SalesChannel, storefront: Storefront, domain: ?StorefrontDomain}
     */
    private function seedWebStorefront(string $tenantId, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', $overrides['channel_slug'] ?? 'web')->first()
            ?? SalesChannel::create([
                'slug' => $overrides['channel_slug'] ?? 'web',
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

        $domain = null;
        if (array_key_exists('hostname', $overrides) && $overrides['hostname'] !== null) {
            $domain = StorefrontDomain::create([
                'storefront_id' => $storefront->id,
                'hostname' => $overrides['hostname'],
                'type' => StorefrontDomain::TYPE_CUSTOM,
                'is_primary' => true,
                'is_active' => true,
                'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            ]);
        }

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront', 'domain');
    }

    /** @test */
    public function get_returns_a_virtual_default_draft_without_inserting_a_row(): void
    {
        $auth = $this->registerTenant('pres-get-default', 'owner@pres-get-default.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])
            ->getJson($this->path($seeded['storefront']->id))
            ->assertOk();

        $this->assertSame($seeded['storefront']->id, $res->json('data.storefront_id'));
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, $res->json('data.schema_version'));
        $this->assertSame(0, $res->json('data.draft_revision'));
        $this->assertNull($res->json('data.published'));
        $this->assertNull($res->json('data.published_revision'));
        $this->assertNull($res->json('data.published_at'));
        $this->assertSame('awj-modern', $res->json('data.draft.themePreset'));
        $this->assertSame('#12372a', $res->json('data.draft.primaryColor'));
        $this->assertArrayNotHasKey('tenant_id', $res->json('data'));
        $this->assertArrayNotHasKey('sales_channel_id', $res->json('data'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, StorefrontPresentation::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function put_persists_a_normalized_draft_and_increments_revision(): void
    {
        $auth = $this->registerTenant('pres-put', 'owner@pres-put.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => [
                    'themePreset' => 'navy',
                    'homepage' => ['heroHeadline' => 'مرحباً بالمسودة'],
                ],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $this->assertSame(1, $res->json('data.draft_revision'));
        $this->assertSame('navy', $res->json('data.draft.themePreset'));
        $this->assertSame('#1e3a5f', $res->json('data.draft.primaryColor'));
        $this->assertSame('مرحباً بالمسودة', $res->json('data.draft.homepage.heroHeadline'));
        $this->assertNull($res->json('data.published'));

        $again = $this->withToken($auth['token'])
            ->getJson($this->path($seeded['storefront']->id))
            ->assertOk();

        $this->assertSame(1, $again->json('data.draft_revision'));
        $this->assertSame('مرحباً بالمسودة', $again->json('data.draft.homepage.heroHeadline'));
    }

    /** @test */
    public function saving_a_draft_does_not_change_published_fields(): void
    {
        $auth = $this->registerTenant('pres-draft-ne-pub', 'owner@pres-draft-ne-pub.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], [
            'hostname' => 'draft-ne-pub.example.com',
        ]);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'منشور أولاً']],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish', ['draft_revision' => 1])
            ->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $before = StorefrontPresentation::query()->where('storefront_id', $seeded['storefront']->id)->first();
        $publishedJson = json_encode($before->published_config);
        $publishedRevision = $before->published_revision;
        $publishedAt = (string) $before->published_at;
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'مسودة لاحقة لا تُنشر']],
                'draft_revision' => 1,
            ])
            ->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $after = StorefrontPresentation::query()->where('storefront_id', $seeded['storefront']->id)->first();
        $this->assertSame($publishedJson, json_encode($after->published_config));
        $this->assertSame($publishedRevision, $after->published_revision);
        $this->assertSame($publishedAt, (string) $after->published_at);
        $this->assertSame('مسودة لاحقة لا تُنشر', $after->draft_config['homepage']['heroHeadline']);
        app(TenantContext::class)->forget();

        $public = $this->getJson('http://draft-ne-pub.example.com/store/v1/storefront')->assertOk();
        $this->assertSame('منشور أولاً', $public->json('data.presentation.homepage.heroHeadline'));
        $this->assertSame('المتجر الرئيسي', $public->json('data.name'));
    }

    /** @test */
    public function a_guest_is_unauthorized(): void
    {
        $auth = $this->registerTenant('pres-guest', 'owner@pres-guest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->getJson($this->path($seeded['storefront']->id))->assertUnauthorized();
        $this->putJson($this->path($seeded['storefront']->id), [
            'config' => ['themePreset' => 'navy'],
            'draft_revision' => 0,
        ])->assertUnauthorized();
    }

    /** @test */
    public function staff_without_commerce_manage_is_forbidden(): void
    {
        $auth = $this->registerTenant('pres-staff', 'owner@pres-staff.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@pres-staff.test');

        $this->withToken($staff)
            ->getJson($this->path($seeded['storefront']->id))
            ->assertForbidden();
        $this->withToken($staff)
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['themePreset' => 'navy'],
                'draft_revision' => 0,
            ])
            ->assertForbidden();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('pres-ss', 'owner@pres-ss.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@pres-ss.test');

        $this->withToken($ss)
            ->getJson($this->path($seeded['storefront']->id))
            ->assertForbidden();
    }

    /** @test */
    public function a_foreign_storefront_is_a_safe_404_and_creates_no_row(): void
    {
        $a = $this->registerTenant('pres-idor-a', 'owner@pres-idor-a.test');
        $b = $this->registerTenant('pres-idor-b', 'owner@pres-idor-b.test');
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $this->withToken($a['token'])
            ->getJson($this->path($seededB['storefront']->id))
            ->assertNotFound()
            ->assertJsonPath('message', 'المتجر غير موجود.');

        $this->withToken($a['token'])
            ->putJson($this->path($seededB['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'تسلل']],
                'draft_revision' => 0,
            ])
            ->assertNotFound();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertSame(0, StorefrontPresentation::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_missing_storefront_is_the_same_404(): void
    {
        $auth = $this->registerTenant('pres-missing', 'owner@pres-missing.test');

        $this->withToken($auth['token'])
            ->getJson($this->path('11111111-1111-1111-1111-111111111111'))
            ->assertNotFound()
            ->assertJsonPath('message', 'المتجر غير موجود.');
    }

    /** @test */
    public function a_malformed_id_does_not_match_the_uuid_route(): void
    {
        $auth = $this->registerTenant('pres-bad-id', 'owner@pres-bad-id.test');

        $this->withToken($auth['token'])
            ->getJson('/api/commerce/workspace/storefronts/not-a-uuid/presentation')
            ->assertNotFound();
    }

    /** @test */
    public function two_storefronts_of_the_same_tenant_are_isolated(): void
    {
        $auth = $this->registerTenant('pres-cross-store', 'owner@pres-cross-store.test');
        $one = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'one', 'name' => 'واحد']);
        $two = $this->seedWebStorefront($auth['tenant_id'], [
            'slug' => 'two',
            'name' => 'اثنان',
            'channel_slug' => 'web-two',
        ]);

        $this->withToken($auth['token'])
            ->putJson($this->path($one['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'فقط للمتجر واحد']],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $resTwo = $this->withToken($auth['token'])
            ->getJson($this->path($two['storefront']->id))
            ->assertOk();

        $this->assertNotSame('فقط للمتجر واحد', $resTwo->json('data.draft.homepage.heroHeadline'));
        $this->assertSame(0, $resTwo->json('data.draft_revision'));
    }

    /** @test */
    public function unknown_envelope_keys_and_authority_fields_are_rejected(): void
    {
        $auth = $this->registerTenant('pres-envelope', 'owner@pres-envelope.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['themePreset' => 'navy'],
                'draft_revision' => 0,
                'tenant_id' => 'forged',
            ])
            ->assertStatus(422);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['themePreset' => 'navy'],
                'draft_revision' => 0,
                'published_config' => ['themePreset' => 'navy'],
            ])
            ->assertStatus(422);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['themePreset' => 'navy'],
                'draft_revision' => 0,
                'is_verified' => true,
            ])
            ->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, StorefrontPresentation::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_stale_draft_revision_returns_409_and_preserves_the_winner(): void
    {
        $auth = $this->registerTenant('pres-409', 'owner@pres-409.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'الفائز']],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['homepage' => ['heroHeadline' => 'المتأخر']],
                'draft_revision' => 0,
            ])
            ->assertStatus(409);

        $res = $this->withToken($auth['token'])
            ->getJson($this->path($seeded['storefront']->id))
            ->assertOk();

        $this->assertSame(1, $res->json('data.draft_revision'));
        $this->assertSame('الفائز', $res->json('data.draft.homepage.heroHeadline'));
    }

    /** @test */
    public function draft_save_does_not_change_storefront_name_or_locale(): void
    {
        $auth = $this->registerTenant('pres-identity', 'owner@pres-identity.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], [
            'name' => 'اسم لا يتغيّر',
            'default_locale' => 'ar',
        ]);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['branding' => ['displayName' => 'اسم ظاهري']],
                'draft_revision' => 0,
            ])
            ->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $fresh = Storefront::query()->find($seeded['storefront']->id);
        $this->assertSame('اسم لا يتغيّر', $fresh->name);
        $this->assertSame('ar', $fresh->default_locale);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function contract2_v2_sections_round_trip_through_save_reload_and_publish(): void
    {
        $auth = $this->registerTenant('pres-c2-roundtrip', 'owner@pres-c2-roundtrip.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $sections = [
            ['id' => 'banner-a', 'type' => 'banner', 'visible' => true],
            ['id' => 'hero', 'type' => 'hero', 'visible' => true],
            ['id' => 'banner-b', 'type' => 'banner', 'visible' => false],
        ];

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => ['version' => 2, 'homepage' => ['sections' => $sections]],
                'draft_revision' => 0,
            ])
            ->assertOk()
            ->assertJsonPath('data.schema_version', StorefrontPresentationNormalizer::VERSION);

        $reloaded = $this->withToken($auth['token'])
            ->getJson($this->path($seeded['storefront']->id))
            ->assertOk();

        $this->assertSame(
            $sections,
            $reloaded->json('data.draft.homepage.sections'),
            'v2: ids/order/visibility تبقى كما هي بعد الحفظ وإعادة التحميل',
        );

        $published = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id).'/publish', ['draft_revision' => 1])
            ->assertOk();

        $this->assertSame($sections, $published->json('data.published.homepage.sections'));

        // إعادة حفظ النتيجة المطبَّعة لا تُحدث churn ولا إحياء للمحذوف.
        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => $reloaded->json('data.draft'),
                'draft_revision' => 1,
            ])
            ->assertOk();

        $twice = $this->withToken($auth['token'])
            ->getJson($this->path($seeded['storefront']->id))
            ->assertOk();

        $this->assertSame($sections, $twice->json('data.draft.homepage.sections'));
    }

    /** @test */
    public function contract2_legacy_v1_document_gets_deterministic_ids_and_stays_stable(): void
    {
        $auth = $this->registerTenant('pres-c2-legacy', 'owner@pres-c2-legacy.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => [
                    'homepage' => [
                        'sections' => [
                            ['key' => 'hero', 'visible' => true],
                            ['key' => 'categories', 'visible' => false],
                        ],
                    ],
                ],
                'draft_revision' => 0,
            ])
            ->assertOk();

        $first = $this->withToken($auth['token'])
            ->getJson($this->path($seeded['storefront']->id))
            ->assertOk();

        $firstSections = $first->json('data.draft.homepage.sections');

        // الترحيل deterministic: id = key، والأقسام الناقصة تُلحق (دلالات v1).
        $this->assertSame('hero', $firstSections[0]['id']);
        $this->assertSame('hero', $firstSections[0]['type']);
        $this->assertTrue($firstSections[0]['visible']);
        $this->assertSame('categories', $firstSections[1]['id']);
        $this->assertFalse($firstSections[1]['visible']);
        $this->assertCount(
            count(StorefrontPresentationNormalizer::HOME_BUILDER_SECTION_KEYS),
            $firstSections,
        );

        // حفظ الناتج ثم إعادة التحميل: لا churn في المعرفات أو الترتيب.
        $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), [
                'config' => $first->json('data.draft'),
                'draft_revision' => 1,
            ])
            ->assertOk();

        $second = $this->withToken($auth['token'])
            ->getJson($this->path($seeded['storefront']->id))
            ->assertOk();

        $this->assertSame($firstSections, $second->json('data.draft.homepage.sections'));
    }
}
