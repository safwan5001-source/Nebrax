<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentationVersion;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CUST-H1-1 — أساس نسخ مظهر المتجر (list/create/read/save/rename/delete).
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationVersionApiTest
 */
class StorefrontPresentationVersionApiTest extends TestCase
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

    private function setHeadPointer(string $storefrontId, string $column, ?string $versionId): void
    {
        DB::table('storefront_presentations')
            ->where('storefront_id', $storefrontId)
            ->update([$column => $versionId]);
    }

    private function forceVersionSchema(string $versionId, int $schemaVersion): void
    {
        DB::table('storefront_presentation_versions')
            ->where('id', $versionId)
            ->update(['schema_version' => $schemaVersion]);
    }

    // ───────────────────────── List ─────────────────────────

    /** @test */
    public function list_returns_empty_array_for_an_untouched_storefront_without_creating_a_row(): void
    {
        $auth = $this->registerTenant('ver-list-empty', 'owner@ver-list-empty.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertOk();

        $this->assertSame([], $res->json('data'));
        $this->assertDatabaseCount('storefront_presentations', 0);
    }

    // ───────────────────────── Create ─────────────────────────

    /** @test */
    public function create_without_source_lazily_creates_the_head_and_a_default_version(): void
    {
        $auth = $this->registerTenant('ver-create-default', 'owner@ver-create-default.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])
            ->postJson($this->listPath($seeded['storefront']->id), ['name' => 'رمضان 1448'])
            ->assertCreated();

        $this->assertSame('رمضان 1448', $res->json('data.name'));
        $this->assertSame('draft', $res->json('data.state'));
        $this->assertSame(1, $res->json('data.revision'));
        $this->assertSame('awj-modern', $res->json('data.config.themePreset'));

        $this->assertDatabaseCount('storefront_presentations', 1);
        $this->assertDatabaseCount('storefront_presentation_versions', 1);
    }

    /** @test */
    public function duplicate_from_source_version_copies_its_normalized_config(): void
    {
        $auth = $this->registerTenant('ver-duplicate', 'owner@ver-duplicate.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $source = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'الأصل'])
            ->assertCreated();
        $sourceId = $source->json('data.id');

        $token->putJson($this->itemPath($seeded['storefront']->id, $sourceId), [
            'config' => ['version' => 2, 'themePreset' => 'burgundy'],
            'revision' => 1,
        ])->assertOk();

        $duplicate = $token->postJson($this->listPath($seeded['storefront']->id), [
            'name' => 'نسخة عن الأصل',
            'source_version_id' => $sourceId,
        ])->assertCreated();

        $this->assertSame('burgundy', $duplicate->json('data.config.themePreset'));
        $this->assertSame(1, $duplicate->json('data.revision'));
        $this->assertSame('draft', $duplicate->json('data.state'));
        $this->assertNotSame($sourceId, $duplicate->json('data.id'));
    }

    /** @test */
    public function duplicating_the_active_published_version_produces_a_draft_not_published(): void
    {
        $auth = $this->registerTenant('ver-duplicate-active', 'owner@ver-duplicate-active.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $active = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'المنشور'])
            ->assertCreated();
        $activeId = $active->json('data.id');
        $this->setHeadPointer($seeded['storefront']->id, 'active_version_id', $activeId);

        $duplicate = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'مسودة جديدة'])
            ->assertCreated();

        $this->assertSame('draft', $duplicate->json('data.state'));
        $this->assertNotSame($activeId, $duplicate->json('data.id'));
    }

    /** @test */
    public function cross_tenant_source_version_id_is_rejected_non_leaking(): void
    {
        $authA = $this->registerTenant('ver-source-a', 'owner@ver-source-a.test');
        $seededA = $this->seedWebStorefront($authA['tenant_id']);
        $sourceVersion = $this->withToken($authA['token'])
            ->postJson($this->listPath($seededA['storefront']->id), ['name' => 'أ'])
            ->assertCreated();

        $authB = $this->registerTenant('ver-source-b', 'owner@ver-source-b.test');
        $seededB = $this->seedWebStorefront($authB['tenant_id']);

        $this->withToken($authB['token'])
            ->postJson($this->listPath($seededB['storefront']->id), [
                'name' => 'محاولة',
                'source_version_id' => $sourceVersion->json('data.id'),
            ])
            ->assertNotFound();

        $this->assertDatabaseCount('storefront_presentation_versions', 1);
    }

    /** @test */
    public function unknown_envelope_keys_are_rejected_on_create(): void
    {
        $auth = $this->registerTenant('ver-create-unknown-keys', 'owner@ver-create-unknown-keys.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson($this->listPath($seeded['storefront']->id), [
                'name' => 'نسخة',
                'tenant_id' => 'x',
            ])
            ->assertStatus(422);
    }

    /**
     * Round-8 review: عند غياب مصدر ونشطة ونسخة عمل معاً (رأسٌ أدخله كاتبٌ
     * قديم بعد هذه الهجرة مباشرة)، كان الاحتياط الأخير يستعمل عمود
     * `draft_schema_version` حرفياً — قد يبقى عند الافتراض (1) رغم أن
     * `draft_config` نفسه v2 فعلياً، فتُطبَّق دلالة v1 (إحياء الأقسام
     * الافتراضية الناقصة) على مستند v2 مكتمل أصلاً.
     */
    /** @test */
    public function create_without_source_derives_the_default_from_the_embedded_draft_tag_not_a_stale_column(): void
    {
        $auth = $this->registerTenant('ver-create-embedded-tag', 'owner@ver-create-embedded-tag.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $v2DraftMissingDefaults = [
            'version' => 2,
            'homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true]]],
        ];

        // يحاكي كاتباً قديماً أدرج رأساً بعد هذه الهجرة مباشرة: draft_config
        // مضمَّن v2 لكن عمود draft_schema_version بقي عند افتراض العمود (1)،
        // وبلا أي مؤشر نسخ إطلاقاً (active/compat كلاهما null).
        DB::table('storefront_presentations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $auth['tenant_id'],
            'storefront_id' => $seeded['storefront']->id,
            'schema_version' => 2,
            'draft_config' => json_encode($v2DraftMissingDefaults),
            'draft_revision' => 1,
            'draft_schema_version' => 1,
            'published_config' => null,
            'published_revision' => null,
            'published_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->withToken($auth['token'])
            ->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة جديدة'])
            ->assertCreated();

        $types = collect($res->json('data.config.homepage.sections'))->pluck('type')->values()->all();
        $this->assertSame(
            ['hero'],
            $types,
            'الوسم المضمَّن في draft_config (v2) يجب أن يُشتقّ منه لا من عمود draft_schema_version المتخلّف، فلا تُستعاد أقسام افتراضية.'
        );
    }

    // ───────────────────────── Read ─────────────────────────

    /** @test */
    public function read_exact_version_returns_normalized_config_and_metadata(): void
    {
        $auth = $this->registerTenant('ver-read', 'owner@ver-read.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $res = $token->getJson($this->itemPath($seeded['storefront']->id, $versionId))->assertOk();

        $this->assertSame($versionId, $res->json('data.id'));
        $this->assertSame($seeded['storefront']->id, $res->json('data.storefront_id'));
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, $res->json('data.schema_version'));
    }

    /** @test */
    public function a_foreign_version_id_is_a_safe_404(): void
    {
        $authA = $this->registerTenant('ver-foreign-a', 'owner@ver-foreign-a.test');
        $seededA = $this->seedWebStorefront($authA['tenant_id']);
        $versionA = $this->withToken($authA['token'])
            ->postJson($this->listPath($seededA['storefront']->id), ['name' => 'أ'])
            ->assertCreated();

        $authB = $this->registerTenant('ver-foreign-b', 'owner@ver-foreign-b.test');
        $seededB = $this->seedWebStorefront($authB['tenant_id']);

        $this->withToken($authB['token'])
            ->getJson($this->itemPath($seededB['storefront']->id, $versionA->json('data.id')))
            ->assertNotFound();
    }

    /** @test */
    public function a_version_from_one_storefront_cannot_be_read_under_another_storefront_of_the_same_tenant(): void
    {
        $auth = $this->registerTenant('ver-cross-storefront', 'owner@ver-cross-storefront.test');
        $seededOne = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'one']);
        $seededTwo = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'two']);
        $token = $this->withToken($auth['token']);

        $version = $token->postJson($this->listPath($seededOne['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();

        $token->getJson($this->itemPath($seededTwo['storefront']->id, $version->json('data.id')))
            ->assertNotFound();
    }

    /** @test */
    public function forward_schema_stored_version_fails_closed_on_read(): void
    {
        $auth = $this->registerTenant('ver-forward-read', 'owner@ver-forward-read.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $this->forceVersionSchema($created->json('data.id'), StorefrontPresentationNormalizer::VERSION + 1);

        $token->getJson($this->itemPath($seeded['storefront']->id, $created->json('data.id')))
            ->assertStatus(409);
    }

    // ───────────────────────── Save ─────────────────────────

    /** @test */
    public function save_persists_normalized_config_and_increments_revision(): void
    {
        $auth = $this->registerTenant('ver-save', 'owner@ver-save.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $res = $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'slate'],
            'revision' => 1,
        ])->assertOk();

        $this->assertSame('slate', $res->json('data.config.themePreset'));
        $this->assertSame(2, $res->json('data.revision'));
    }

    /** @test */
    public function save_persists_page_presentation_and_duplicate_copies_it_unchanged(): void
    {
        // CUST-H2-1 — proves the additive `pagePresentation` namespace survives
        // the two H1 lifecycle paths this slice's schema bump touches most
        // directly: a whole-document Save, and a Duplicate that copies the
        // source Version's already-normalized config verbatim.
        $auth = $this->registerTenant('ver-save-page-presentation', 'owner@ver-save-page-presentation.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $res = $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => [
                'version' => 3,
                'themePreset' => 'slate',
                'pagePresentation' => [
                    'product' => [
                        'regions' => [
                            ['key' => 'media_gallery', 'visible' => false],
                            ['key' => 'description', 'visible' => true],
                        ],
                    ],
                ],
            ],
            'revision' => 1,
        ])->assertOk();

        $this->assertSame(3, $res->json('data.config.version'));
        $productRegions = collect($res->json('data.config.pagePresentation.product.regions'))->keyBy('key');
        // FIXED_REQUIRED forced back to visible=true regardless of the false sent above.
        $this->assertTrue($productRegions['media_gallery']['visible']);
        $this->assertTrue($productRegions['description']['visible']);
        $this->assertArrayNotHasKey('category', $res->json('data.config.pagePresentation'));

        $duplicate = $token->postJson($this->listPath($seeded['storefront']->id), [
            'name' => 'نسخة عن الأصل',
            'source_version_id' => $versionId,
        ])->assertCreated();

        $this->assertSame(
            $res->json('data.config.pagePresentation'),
            $duplicate->json('data.config.pagePresentation'),
        );
    }

    /** @test */
    public function a_stale_save_revision_returns_409_and_preserves_the_winner(): void
    {
        $auth = $this->registerTenant('ver-stale-save', 'owner@ver-stale-save.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'burgundy'],
            'revision' => 1,
        ])->assertOk();

        $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'sand'],
            'revision' => 1,
        ])->assertStatus(409);

        $read = $token->getJson($this->itemPath($seeded['storefront']->id, $versionId))->assertOk();
        $this->assertSame('burgundy', $read->json('data.config.themePreset'));
        $this->assertSame(2, $read->json('data.revision'));
    }

    /** @test */
    public function different_versions_can_be_saved_independently_without_conflict(): void
    {
        $auth = $this->registerTenant('ver-independent-save', 'owner@ver-independent-save.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $a = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'أ'])->assertCreated();
        $b = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'ب'])->assertCreated();

        $token->putJson($this->itemPath($seeded['storefront']->id, $a->json('data.id')), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'revision' => 1,
        ])->assertOk();

        $token->putJson($this->itemPath($seeded['storefront']->id, $b->json('data.id')), [
            'config' => ['version' => 2, 'themePreset' => 'sand'],
            'revision' => 1,
        ])->assertOk();
    }

    /** @test */
    public function saving_the_active_published_version_is_rejected_with_409(): void
    {
        $auth = $this->registerTenant('ver-save-active', 'owner@ver-save-active.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'منشور'])
            ->assertCreated();
        $versionId = $created->json('data.id');
        $this->setHeadPointer($seeded['storefront']->id, 'active_version_id', $versionId);

        $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'revision' => 1,
        ])->assertStatus(409);

        $this->assertSame(1, StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->revision);
    }

    /** @test */
    public function forward_schema_incoming_config_version_fails_closed_before_persisting(): void
    {
        $auth = $this->registerTenant('ver-forward-save', 'owner@ver-forward-save.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => ['version' => StorefrontPresentationNormalizer::VERSION + 1, 'themePreset' => 'burgundy'],
            'revision' => 1,
        ])->assertStatus(409);

        $stored = StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);
        $this->assertSame(1, (int) $stored->revision);
        $this->assertSame('awj-modern', $stored->config['themePreset']);
    }

    /** @test */
    public function forward_schema_source_version_is_rejected_on_duplicate_without_creating_a_copy(): void
    {
        $auth = $this->registerTenant('ver-forward-duplicate', 'owner@ver-forward-duplicate.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'مستقبلية'])
            ->assertCreated();
        $this->forceVersionSchema($created->json('data.id'), StorefrontPresentationNormalizer::VERSION + 1);

        $token->postJson($this->listPath($seeded['storefront']->id), [
            'name' => 'تكرار',
            'source_version_id' => $created->json('data.id'),
        ])->assertStatus(409);

        $this->assertDatabaseCount('storefront_presentation_versions', 1);
    }

    // ───────────────────────── Rename ─────────────────────────

    /** @test */
    public function rename_updates_name_and_increments_revision(): void
    {
        $auth = $this->registerTenant('ver-rename', 'owner@ver-rename.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'الاسم القديم'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $res = $token->patchJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'name' => 'الاسم الجديد',
            'revision' => 1,
        ])->assertOk();

        $this->assertSame('الاسم الجديد', $res->json('data.name'));
        $this->assertSame(2, $res->json('data.revision'));
    }

    /**
     * Round-9 review: إعادة التسمية كانت الاستثناء الوحيد بين مسارات
     * القراءة/الحفظ/التكرار — لا تفحص وسم النسخة المخزَّن إطلاقاً، فتُثبَّت
     * إعادة التسمية بصمت على نسخة بمخطط أمامي، ثم يُطبِّع `detail()` مستندها
     * صامتاً إلى افتراضي AWJ Modern بدل رفض الطلب بـ409.
     */
    /** @test */
    public function renaming_a_forward_schema_version_fails_closed_without_mutating_it(): void
    {
        $auth = $this->registerTenant('ver-rename-forward', 'owner@ver-rename-forward.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'مستقبلية'])
            ->assertCreated();
        $versionId = $created->json('data.id');
        $this->forceVersionSchema($versionId, StorefrontPresentationNormalizer::VERSION + 1);

        $token->patchJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'name' => 'اسم جديد',
            'revision' => 1,
        ])->assertStatus(409);

        $unchanged = StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);
        $this->assertSame('مستقبلية', $unchanged->name);
        $this->assertSame(1, (int) $unchanged->revision);
    }

    /** @test */
    public function a_stale_rename_revision_returns_409(): void
    {
        $auth = $this->registerTenant('ver-stale-rename', 'owner@ver-stale-rename.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'الاسم'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $token->patchJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'name' => 'اسم 1',
            'revision' => 1,
        ])->assertOk();

        $token->patchJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'name' => 'اسم 2',
            'revision' => 1,
        ])->assertStatus(409);
    }

    // ───────────────────────── Delete ─────────────────────────

    /** @test */
    public function delete_eligible_draft_succeeds(): void
    {
        $auth = $this->registerTenant('ver-delete-eligible', 'owner@ver-delete-eligible.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'مسودة'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $token->deleteJson($this->itemPath($seeded['storefront']->id, $versionId))->assertNoContent();

        $this->assertDatabaseMissing('storefront_presentation_versions', ['id' => $versionId]);
    }

    /** @test */
    public function deleting_the_active_version_is_rejected_with_409(): void
    {
        $auth = $this->registerTenant('ver-delete-active', 'owner@ver-delete-active.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'منشور'])
            ->assertCreated();
        $versionId = $created->json('data.id');
        $this->setHeadPointer($seeded['storefront']->id, 'active_version_id', $versionId);

        $token->deleteJson($this->itemPath($seeded['storefront']->id, $versionId))->assertStatus(409);

        $this->assertDatabaseHas('storefront_presentation_versions', ['id' => $versionId]);
    }

    /** @test */
    public function deleting_the_scheduled_version_is_rejected_with_409(): void
    {
        $auth = $this->registerTenant('ver-delete-scheduled', 'owner@ver-delete-scheduled.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'مجدولة'])
            ->assertCreated();
        $versionId = $created->json('data.id');
        $this->setHeadPointer($seeded['storefront']->id, 'scheduled_version_id', $versionId);

        $token->deleteJson($this->itemPath($seeded['storefront']->id, $versionId))->assertStatus(409);

        $this->assertDatabaseHas('storefront_presentation_versions', ['id' => $versionId]);
    }

    /** @test */
    public function deleting_the_compatibility_working_version_is_rejected_during_the_transition_window(): void
    {
        $auth = $this->registerTenant('ver-delete-compat', 'owner@ver-delete-compat.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'نسخة العمل'])
            ->assertCreated();
        $versionId = $created->json('data.id');
        $this->setHeadPointer($seeded['storefront']->id, 'compatibility_working_version_id', $versionId);

        $token->deleteJson($this->itemPath($seeded['storefront']->id, $versionId))->assertStatus(409);

        $this->assertDatabaseHas('storefront_presentation_versions', ['id' => $versionId]);
    }

    /** @test */
    public function a_foreign_version_delete_is_a_safe_404(): void
    {
        $authA = $this->registerTenant('ver-delete-foreign-a', 'owner@ver-delete-foreign-a.test');
        $seededA = $this->seedWebStorefront($authA['tenant_id']);
        $versionA = $this->withToken($authA['token'])
            ->postJson($this->listPath($seededA['storefront']->id), ['name' => 'أ'])
            ->assertCreated();

        $authB = $this->registerTenant('ver-delete-foreign-b', 'owner@ver-delete-foreign-b.test');
        $seededB = $this->seedWebStorefront($authB['tenant_id']);

        $this->withToken($authB['token'])
            ->deleteJson($this->itemPath($seededB['storefront']->id, $versionA->json('data.id')))
            ->assertNotFound();

        $this->assertDatabaseHas('storefront_presentation_versions', ['id' => $versionA->json('data.id')]);
    }

    // ───────────────────────── Guards ─────────────────────────

    /** @test */
    public function a_guest_is_unauthorized(): void
    {
        $auth = $this->registerTenant('ver-guest', 'owner@ver-guest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->getJson($this->listPath($seeded['storefront']->id))->assertUnauthorized();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('ver-self-service', 'owner@ver-self-service.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self@ver-self-service.test');

        $this->withToken($token)
            ->getJson($this->listPath($seeded['storefront']->id))
            ->assertForbidden();
    }
}
