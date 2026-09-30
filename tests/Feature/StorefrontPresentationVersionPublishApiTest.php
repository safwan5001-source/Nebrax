<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CUST-H1-3 — نشر فوري لنسخة عرض محدَّدة تماماً. مرجعها المعماري:
 * `docs/plans/store/CUST-H1-ARCH-1-...md` §11.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationVersionPublishApiTest
 */
class StorefrontPresentationVersionPublishApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function listPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/versions';
    }

    private function itemPath(string $id, string $versionId): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/versions/'.$versionId;
    }

    private function publishPath(string $id, string $versionId): string
    {
        return $this->itemPath($id, $versionId).'/publish';
    }

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    private function seedWebStorefront(string $tenantId, array $overrides = []): array
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
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    /** @return array{channel: SalesChannel, storefront: Storefront, domain: StorefrontDomain} */
    private function seedPublicStorefront(string $tenantId, string $hostname, array $overrides = []): array
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

    private function presentationHead(string $storefrontId): ?StorefrontPresentation
    {
        return StorefrontPresentation::withoutGlobalScopes()
            ->where('storefront_id', $storefrontId)
            ->first();
    }

    private function setHeadPointer(string $storefrontId, string $column, ?string $value): void
    {
        DB::table('storefront_presentations')
            ->where('storefront_id', $storefrontId)
            ->update([$column => $value]);
    }

    private function forceVersionRow(string $versionId, array $attributes): void
    {
        DB::table('storefront_presentation_versions')
            ->where('id', $versionId)
            ->update($attributes);
    }

    // ───────────────────────── Success ─────────────────────────

    /** @test */
    public function publishing_an_eligible_draft_makes_it_the_active_published_version(): void
    {
        $auth = $this->registerTenant('pub-ok', 'owner@pub-ok.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'رمضان 1448'])
            ->assertCreated();
        $versionId = $created->json('data.id');
        $this->assertNull($created->json('data.published_revision'));

        $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'revision' => 1,
        ])->assertOk();

        $res = $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 2,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $this->assertSame('published', $res->json('data.state'));
        $this->assertNotNull($res->json('data.last_published_at'));
        $this->assertSame(1, $res->json('data.published_revision'));

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($versionId, $head->active_version_id);
        $this->assertSame(1, (int) $head->published_revision);
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, (int) $head->published_schema_version);
        $this->assertNotNull($head->published_at);
        $this->assertSame('navy', $head->published_config['themePreset']);
    }

    /** @test */
    public function the_list_endpoint_exposes_the_same_publication_head_revision_on_every_row(): void
    {
        $auth = $this->registerTenant('pub-head-in-list', 'owner@pub-head-in-list.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $a = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'أ'])->assertCreated();
        $b = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'ب'])->assertCreated();

        $listBeforePublish = $token->getJson($this->listPath($seeded['storefront']->id))->assertOk();
        foreach ($listBeforePublish->json('data') as $row) {
            $this->assertNull($row['published_revision']);
        }

        $token->postJson($this->publishPath($seeded['storefront']->id, $a->json('data.id')), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $listAfterPublish = $token->getJson($this->listPath($seeded['storefront']->id))->assertOk();
        $rows = collect($listAfterPublish->json('data'))->keyBy('id');
        $this->assertSame(1, $rows[$a->json('data.id')]['published_revision']);
        $this->assertSame(1, $rows[$b->json('data.id')]['published_revision']);
        $this->assertSame('published', $rows[$a->json('data.id')]['state']);
        $this->assertSame('draft', $rows[$b->json('data.id')]['state']);
    }

    /** @test */
    public function published_config_is_byte_identical_to_the_published_versions_normalized_config(): void
    {
        $auth = $this->registerTenant('pub-parity', 'owner@pub-parity.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'burgundy', 'homepage' => ['heroHeadline' => 'أهلاً']],
            'revision' => 1,
        ])->assertOk();

        $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 2,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $head = $this->presentationHead($seeded['storefront']->id);
        $version = StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);

        $this->assertSame(
            json_encode($version->config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            json_encode($head->published_config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        );
    }

    /** @test */
    public function publishing_a_version_with_page_presentation_preserves_it_unchanged(): void
    {
        // CUST-H2-1 — the additive `pagePresentation` namespace is part of the
        // same whole-document config this test file already proves publishes
        // byte-identically; this asserts that holds for the new key too.
        $auth = $this->registerTenant('pub-page-presentation', 'owner@pub-page-presentation.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => [
                'version' => 3,
                'pagePresentation' => [
                    'category' => [
                        'regions' => [
                            ['key' => 'breadcrumbs', 'visible' => false],
                            ['key' => 'subcategories_rail', 'visible' => true],
                        ],
                    ],
                ],
            ],
            'revision' => 1,
        ])->assertOk();

        $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 2,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $head = $this->presentationHead($seeded['storefront']->id);
        $categoryRegions = collect($head->published_config['pagePresentation']['category']['regions'])->keyBy('key');
        // FIXED_REQUIRED forced back to visible=true regardless of the false sent above.
        $this->assertTrue($categoryRegions['breadcrumbs']['visible']);
        $this->assertTrue($categoryRegions['subcategories_rail']['visible']);
        $this->assertArrayNotHasKey('product', $head->published_config['pagePresentation']);
    }

    /** @test */
    public function publishing_a_new_version_retains_the_former_published_version_as_draft(): void
    {
        $auth = $this->registerTenant('pub-retain', 'owner@pub-retain.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $a = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'أ'])->assertCreated();
        $aId = $a->json('data.id');
        $token->postJson($this->publishPath($seeded['storefront']->id, $aId), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $b = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');

        $res = $token->postJson($this->publishPath($seeded['storefront']->id, $bId), [
            'revision' => 1,
            'expected_published_revision' => 1,
            'expected_active_version_id' => $aId,
        ])->assertOk();

        $this->assertSame('published', $res->json('data.state'));

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($bId, $head->active_version_id);
        $this->assertSame(2, (int) $head->published_revision);

        $this->assertDatabaseHas('storefront_presentation_versions', ['id' => $aId]);

        $list = $token->getJson($this->listPath($seeded['storefront']->id))->assertOk();
        $states = collect($list->json('data'))->keyBy('id');
        $this->assertSame('draft', $states[$aId]['state']);
        $this->assertSame('published', $states[$bId]['state']);
    }

    /** @test */
    public function public_storefront_renders_the_newly_published_version(): void
    {
        $auth = $this->registerTenant('pub-public', 'owner@pub-public.test');
        $seeded = $this->seedPublicStorefront($auth['tenant_id'], 'pub-h1-3.example.com');
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'slate', 'homepage' => ['heroHeadline' => 'مرحباً بالعالم']],
            'revision' => 1,
        ])->assertOk();

        $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 2,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $res = $this->getJson('http://pub-h1-3.example.com/store/v1/storefront')->assertOk();
        $this->assertSame('slate', $res->json('data.presentation.themePreset'));
        $this->assertSame('مرحباً بالعالم', $res->json('data.presentation.homepage.heroHeadline'));
    }

    /** @test */
    public function failed_publish_leaves_the_public_snapshot_unchanged(): void
    {
        $auth = $this->registerTenant('pub-fail-keep', 'owner@pub-fail-keep.test');
        $seeded = $this->seedPublicStorefront($auth['tenant_id'], 'pub-h1-3-fail.example.com');
        $token = $this->withToken($auth['token']);

        $a = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'أ'])->assertCreated();
        $aId = $a->json('data.id');
        $token->putJson($this->itemPath($seeded['storefront']->id, $aId), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'revision' => 1,
        ])->assertOk();
        $token->postJson($this->publishPath($seeded['storefront']->id, $aId), [
            'revision' => 2,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $b = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');

        // رأس نشر قديم عمداً (مراجعة/مؤشر خاطئان) → 409 قبل أي تغيير حالة حيّة.
        $token->postJson($this->publishPath($seeded['storefront']->id, $bId), [
            'revision' => 1,
            'expected_published_revision' => 999,
            'expected_active_version_id' => $aId,
        ])->assertStatus(409);

        $res = $this->getJson('http://pub-h1-3-fail.example.com/store/v1/storefront')->assertOk();
        $this->assertSame('navy', $res->json('data.presentation.themePreset'));

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($aId, $head->active_version_id);
        $this->assertSame(1, (int) $head->published_revision);
    }

    /** @test */
    public function publishing_the_already_active_unchanged_version_is_idempotent_and_does_not_rewrite_published_at(): void
    {
        $auth = $this->registerTenant('pub-noop', 'owner@pub-noop.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $before = $this->presentationHead($seeded['storefront']->id);

        $res = $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 1,
            'expected_published_revision' => 1,
            'expected_active_version_id' => $versionId,
        ])->assertOk();

        $this->assertSame('published', $res->json('data.state'));

        $after = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame(1, (int) $after->published_revision);
        $this->assertTrue($before->published_at->equalTo($after->published_at));
    }

    /** @test */
    public function normalization_upgrade_is_persisted_atomically_without_bumping_the_merchant_facing_revision(): void
    {
        $auth = $this->registerTenant('pub-normalize', 'owner@pub-normalize.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة قديمة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        // محاكاة نسخة مهاجَرة بإصدار v1 (بلا `version` مضمَّن، ووسم عمود v1).
        $this->forceVersionRow($versionId, [
            'schema_version' => 1,
            'config' => json_encode(['themePreset' => 'awj-modern', 'homepage' => ['heroHeadline' => 'قديم']]),
        ]);

        $res = $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $this->assertSame(1, $res->json('data.revision'));
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, $res->json('data.schema_version'));

        $version = StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);
        $this->assertSame(1, (int) $version->revision);
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, (int) $version->schema_version);
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, $version->config['version']);
    }

    // ───────────────────────── Concurrency ─────────────────────────

    /** @test */
    public function stale_target_revision_returns_409_without_mutating_state(): void
    {
        $auth = $this->registerTenant('pub-stale-rev', 'owner@pub-stale-rev.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 2,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertStatus(409);

        $this->assertNull($this->presentationHead($seeded['storefront']->id)?->active_version_id);
    }

    /** @test */
    public function stale_expected_published_revision_returns_409(): void
    {
        $auth = $this->registerTenant('pub-stale-pubrev', 'owner@pub-stale-pubrev.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $a = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'أ'])->assertCreated();
        $aId = $a->json('data.id');
        $token->postJson($this->publishPath($seeded['storefront']->id, $aId), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $b = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');

        $token->postJson($this->publishPath($seeded['storefront']->id, $bId), [
            'revision' => 1,
            'expected_published_revision' => 0,
            'expected_active_version_id' => $aId,
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($aId, $head->active_version_id);
        $this->assertSame(1, (int) $head->published_revision);
    }

    /** @test */
    public function stale_expected_active_version_id_returns_409(): void
    {
        $auth = $this->registerTenant('pub-stale-active', 'owner@pub-stale-active.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $a = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'أ'])->assertCreated();
        $aId = $a->json('data.id');
        $token->postJson($this->publishPath($seeded['storefront']->id, $aId), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $b = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');

        $token->postJson($this->publishPath($seeded['storefront']->id, $bId), [
            'revision' => 1,
            'expected_published_revision' => 1,
            'expected_active_version_id' => null,
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($aId, $head->active_version_id);
        $this->assertSame(1, (int) $head->published_revision);
    }

    /** @test */
    public function scheduled_target_returns_409_without_cancelling_the_schedule(): void
    {
        $auth = $this->registerTenant('pub-scheduled', 'owner@pub-scheduled.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'مجدولة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $this->setHeadPointer($seeded['storefront']->id, 'scheduled_version_id', $versionId);
        $this->forceVersionRow($versionId, ['scheduled_for' => now()->addDay()->toDateTimeString()]);

        $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($versionId, $head->scheduled_version_id);
        $this->assertNull($head->active_version_id);

        $version = StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);
        $this->assertNotNull($version->scheduled_for);
    }

    /** @test */
    public function forward_schema_target_fails_closed_with_zero_mutation(): void
    {
        $auth = $this->registerTenant('pub-forward', 'owner@pub-forward.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'مستقبلية'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $forwardVersion = StorefrontPresentationNormalizer::VERSION + 1;
        $this->forceVersionRow($versionId, [
            'schema_version' => $forwardVersion,
            'config' => json_encode(['version' => $forwardVersion, 'themePreset' => 'navy']),
        ]);

        $token->postJson($this->publishPath($seeded['storefront']->id, $versionId), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head?->active_version_id);
        $this->assertNull($head?->published_config);

        $version = StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);
        $this->assertSame($forwardVersion, (int) $version->schema_version);
        $this->assertSame(1, (int) $version->revision);
    }

    // ───────────────────────── Isolation ─────────────────────────

    /** @test */
    public function cross_tenant_storefront_publish_is_a_safe_404(): void
    {
        $authA = $this->registerTenant('pub-cross-a', 'owner@pub-cross-a.test');
        $seededA = $this->seedWebStorefront($authA['tenant_id']);
        $versionA = $this->withToken($authA['token'])
            ->postJson($this->listPath($seededA['storefront']->id), ['name' => 'أ'])
            ->assertCreated();

        $authB = $this->registerTenant('pub-cross-b', 'owner@pub-cross-b.test');

        $this->withToken($authB['token'])
            ->postJson($this->publishPath($seededA['storefront']->id, $versionA->json('data.id')), [
                'revision' => 1,
                'expected_published_revision' => null,
                'expected_active_version_id' => null,
            ])
            ->assertNotFound();

        $this->assertNull($this->presentationHead($seededA['storefront']->id)?->active_version_id);
    }

    /** @test */
    public function cross_tenant_version_under_an_owned_storefront_url_is_a_safe_404(): void
    {
        $authA = $this->registerTenant('pub-cross-ver-a', 'owner@pub-cross-ver-a.test');
        $seededA = $this->seedWebStorefront($authA['tenant_id']);
        $versionA = $this->withToken($authA['token'])
            ->postJson($this->listPath($seededA['storefront']->id), ['name' => 'أ'])
            ->assertCreated();

        $authB = $this->registerTenant('pub-cross-ver-b', 'owner@pub-cross-ver-b.test');
        $seededB = $this->seedWebStorefront($authB['tenant_id']);

        $this->withToken($authB['token'])
            ->postJson($this->publishPath($seededB['storefront']->id, $versionA->json('data.id')), [
                'revision' => 1,
                'expected_published_revision' => null,
                'expected_active_version_id' => null,
            ])
            ->assertNotFound();
    }

    /** @test */
    public function same_tenant_cross_storefront_version_publish_is_a_safe_404(): void
    {
        $auth = $this->registerTenant('pub-same-tenant-cross', 'owner@pub-same-tenant-cross.test');
        $seededOne = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'one']);
        $seededTwo = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'two']);
        $token = $this->withToken($auth['token']);

        $version = $token->postJson($this->listPath($seededOne['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();

        $token->postJson($this->publishPath($seededTwo['storefront']->id, $version->json('data.id')), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertNotFound();
    }

    /** @test */
    public function a_missing_version_is_a_safe_404(): void
    {
        $auth = $this->registerTenant('pub-missing', 'owner@pub-missing.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson($this->publishPath($seeded['storefront']->id, (string) \Illuminate\Support\Str::uuid()), [
                'revision' => 1,
                'expected_published_revision' => null,
                'expected_active_version_id' => null,
            ])
            ->assertNotFound();
    }

    // ───────────────────────── Request envelope ─────────────────────────

    /** @test */
    public function unknown_envelope_keys_are_rejected_on_publish(): void
    {
        $auth = $this->registerTenant('pub-unknown-keys', 'owner@pub-unknown-keys.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();

        $token->postJson($this->publishPath($seeded['storefront']->id, $created->json('data.id')), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
            'tenant_id' => 'x',
        ])->assertStatus(422);
    }

    /** @test */
    public function missing_publication_head_fields_are_rejected(): void
    {
        $auth = $this->registerTenant('pub-missing-fields', 'owner@pub-missing-fields.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();

        $token->postJson($this->publishPath($seeded['storefront']->id, $created->json('data.id')), [
            'revision' => 1,
        ])->assertStatus(422);
    }

    // ───────────────────────── Guards ─────────────────────────

    /** @test */
    public function a_guest_is_unauthorized(): void
    {
        $auth = $this->registerTenant('pub-guest', 'owner@pub-guest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        // بلا توكن — `auth:sanctum` يجب أن يرفض قبل أي وصول للمورد، بصرف
        // النظر عن وجوده؛ معرّف عشوائي يتجنّب تلويث `$this` بترويسة `withToken`
        // (تبقى مُثبَّتةً على كل طلب لاحق عبر نفس النسخة).
        $this->postJson($this->publishPath($seeded['storefront']->id, (string) \Illuminate\Support\Str::uuid()), [
            'revision' => 1,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertUnauthorized();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('pub-self-service', 'owner@pub-self-service.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();

        $selfServiceToken = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self@pub-self-service.test');

        $this->withToken($selfServiceToken)
            ->postJson($this->publishPath($seeded['storefront']->id, $created->json('data.id')), [
                'revision' => 1,
                'expected_published_revision' => null,
                'expected_active_version_id' => null,
            ])
            ->assertForbidden();
    }
}
