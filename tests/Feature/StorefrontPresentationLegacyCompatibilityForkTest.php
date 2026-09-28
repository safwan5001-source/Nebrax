<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use App\Services\Commerce\StorefrontPresentationService;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CUST-H1-1 §14/§15/§21 — توافق واجهة المسودة القديمة (GET/PUT) مع نسخ
 * العرض الجديدة: ضمان نسخة العمل المتوافقة كسولاً، والتشويك (fork) قبل
 * تعديل نسخة منشورة نشطة عبر الواجهة القديمة، مع استمرارية المراجعة.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationLegacyCompatibilityForkTest
 */
class StorefrontPresentationLegacyCompatibilityForkTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function legacyPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    private function legacyPublishPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/publish';
    }

    private function versionsPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/versions';
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

    private function insertLegacyRow(Storefront $storefront, array $overrides = []): string
    {
        $id = (string) Str::uuid();

        DB::table('storefront_presentations')->insert(array_merge([
            'id' => $id,
            'tenant_id' => $storefront->tenant_id,
            'storefront_id' => $storefront->id,
            'schema_version' => 2,
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 3,
            'published_config' => null,
            'published_revision' => null,
            'published_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));

        return $id;
    }

    /** @test */
    public function legacy_get_lazily_creates_the_compatibility_working_version_without_changing_the_response_shape(): void
    {
        $auth = $this->registerTenant('legacy-get-lazy', 'owner@legacy-get-lazy.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $rowId = $this->insertLegacyRow($seeded['storefront'], [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'burgundy']),
            'draft_revision' => 4,
        ]);

        $res = $this->withToken($auth['token'])
            ->getJson($this->legacyPath($seeded['storefront']->id))
            ->assertOk();

        $res->assertJsonStructure([
            'data' => ['storefront_id', 'schema_version', 'draft', 'draft_revision', 'published', 'published_revision', 'published_at'],
        ]);
        $this->assertSame($seeded['storefront']->id, $res->json('data.storefront_id'));
        $this->assertSame(4, $res->json('data.draft_revision'));
        $this->assertSame('burgundy', $res->json('data.draft.themePreset'));

        $head = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $this->assertNotNull($head->compatibility_working_version_id);

        $compat = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->compatibility_working_version_id);
        $this->assertSame(4, (int) $compat->revision);
        $this->assertSame('burgundy', $compat->config['themePreset']);
    }

    /** @test */
    public function legacy_put_synchronizes_the_compatibility_version_and_head_atomically(): void
    {
        $auth = $this->registerTenant('legacy-put-sync', 'owner@legacy-put-sync.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $rowId = $this->insertLegacyRow($seeded['storefront'], [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 2,
        ]);

        $this->withToken($auth['token'])
            ->putJson($this->legacyPath($seeded['storefront']->id), [
                'config' => ['version' => 2, 'themePreset' => 'sand'],
                'draft_revision' => 2,
            ])
            ->assertOk()
            ->assertJsonPath('data.draft_revision', 3)
            ->assertJsonPath('data.draft.themePreset', 'sand');

        $head = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $this->assertSame(3, (int) $head->draft_revision);
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, (int) $head->draft_schema_version);

        $compat = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->compatibility_working_version_id);
        $this->assertSame(3, (int) $compat->revision);
        $this->assertSame('sand', $compat->config['themePreset']);
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, (int) $compat->schema_version);
    }

    /** @test */
    public function legacy_edit_forks_a_draft_before_mutating_the_active_published_version_and_preserves_revision_continuity(): void
    {
        $auth = $this->registerTenant('legacy-fork', 'owner@legacy-fork.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        // ننشئ نسخة عبر الواجهة الجديدة ثم نحاكي حالة الهجرة B: نفس النسخة
        // منشورة (active) وهي نسخة العمل المتوافقة (compat) في آنٍ واحد.
        $created = $token->postJson($this->versionsPath($seeded['storefront']->id), ['name' => 'المنشور الحالي'])
            ->assertCreated();
        $publishedVersionId = $created->json('data.id');

        $token->putJson($this->versionsPath($seeded['storefront']->id).'/'.$publishedVersionId, [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'revision' => 1,
        ])->assertOk();

        DB::table('storefront_presentations')
            ->where('storefront_id', $seeded['storefront']->id)
            ->update([
                'active_version_id' => $publishedVersionId,
                'compatibility_working_version_id' => $publishedVersionId,
                'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
                'draft_revision' => 2,
                'draft_schema_version' => StorefrontPresentationNormalizer::VERSION,
            ]);

        // عميل قديم يعدّل عبر PUT بمراجعته الحالية (2) — يجب أن يُشوَّك بدل
        // تعديل النسخة المنشورة النشطة مباشرة.
        $res = $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => 2, 'themePreset' => 'burgundy'],
            'draft_revision' => 2,
        ])->assertOk();

        $this->assertSame(3, $res->json('data.draft_revision'));
        $this->assertSame('burgundy', $res->json('data.draft.themePreset'));

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seeded['storefront']->id)->first();
        $this->assertSame($publishedVersionId, $head->active_version_id, 'النسخة المنشورة النشطة يجب أن تبقى كما هي.');
        $this->assertNotSame($publishedVersionId, $head->compatibility_working_version_id, 'يجب أن يتحوّل مؤشر نسخة العمل إلى فرع جديد.');

        $fork = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->compatibility_working_version_id);
        $this->assertSame(3, (int) $fork->revision, 'استمرارية المراجعة: الفرع يبدأ من مراجعة المسودة القديمة + 1.');
        $this->assertSame('burgundy', $fork->config['themePreset']);

        // مراجعتها الحالية 2 (أُنشئت بـ1، ثم حُفظت مرة عبر PUT النسخ قبل
        // تعيينها منشورة) — المهم أنها لم تتغيّر بفعل تعديل العميل القديم.
        $active = StorefrontPresentationVersion::withoutGlobalScopes()->find($publishedVersionId);
        $this->assertSame(2, (int) $active->revision, 'النسخة المنشورة النشطة الأصلية يجب أن تبقى دون تعديل.');
        $this->assertSame('navy', $active->config['themePreset']);
    }

    /** @test */
    public function legacy_put_fails_closed_when_the_compatibility_version_carries_a_forward_schema(): void
    {
        $auth = $this->registerTenant('legacy-forward-put', 'owner@legacy-forward-put.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $rowId = $this->insertLegacyRow($seeded['storefront'], [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 1,
        ]);

        // نضمن نسخة العمل المتوافقة أولاً عبر GET، ثم نجعل مخططها مستقبلياً.
        $token->getJson($this->legacyPath($seeded['storefront']->id))->assertOk();
        $head = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        DB::table('storefront_presentation_versions')
            ->where('id', $head->compatibility_working_version_id)
            ->update(['schema_version' => StorefrontPresentationNormalizer::VERSION + 1]);

        $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => 2, 'themePreset' => 'burgundy'],
            'draft_revision' => 1,
        ])->assertStatus(409);

        $unchanged = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $this->assertSame(1, (int) $unchanged->draft_revision);
    }

    /** @test */
    public function legacy_put_rejects_a_forward_declared_config_version_before_normalizing(): void
    {
        $auth = $this->registerTenant('legacy-incoming-forward', 'owner@legacy-incoming-forward.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $rowId = $this->insertLegacyRow($seeded['storefront'], [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 1,
        ]);

        $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => StorefrontPresentationNormalizer::VERSION + 1, 'themePreset' => 'burgundy'],
            'draft_revision' => 1,
        ])->assertStatus(409);

        $unchanged = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $this->assertSame(1, (int) $unchanged->draft_revision);
        $this->assertSame('navy', $unchanged->draft_config['themePreset']);
    }

    /** @test */
    public function legacy_get_fails_closed_when_the_stored_draft_schema_is_forward(): void
    {
        $auth = $this->registerTenant('legacy-forward-get', 'owner@legacy-forward-get.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $this->insertLegacyRow($seeded['storefront'], [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 1,
            'draft_schema_version' => StorefrontPresentationNormalizer::VERSION + 1,
        ]);

        $token->getJson($this->legacyPath($seeded['storefront']->id))->assertStatus(409);
    }

    /** @test */
    public function legacy_publish_fails_closed_when_the_stored_draft_schema_is_forward(): void
    {
        $auth = $this->registerTenant('legacy-forward-publish', 'owner@legacy-forward-publish.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $rowId = $this->insertLegacyRow($seeded['storefront'], [
            'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
            'draft_revision' => 1,
            'draft_schema_version' => StorefrontPresentationNormalizer::VERSION + 1,
        ]);

        $token->postJson($this->legacyPublishPath($seeded['storefront']->id), [])->assertStatus(409);

        $unchanged = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $this->assertNull($unchanged->published_config);
    }

    /** @test */
    public function legacy_publish_promotes_the_forked_compatibility_version_to_active(): void
    {
        $auth = $this->registerTenant('legacy-publish-promotes-fork', 'owner@legacy-publish-promotes-fork.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        // نفس تمهيد اختبار التشويك: نسخة منشورة نشطة هي أيضاً نسخة العمل.
        $created = $token->postJson($this->versionsPath($seeded['storefront']->id), ['name' => 'المنشور الحالي'])
            ->assertCreated();
        $originalActiveId = $created->json('data.id');

        $token->putJson($this->versionsPath($seeded['storefront']->id).'/'.$originalActiveId, [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'revision' => 1,
        ])->assertOk();

        DB::table('storefront_presentations')
            ->where('storefront_id', $seeded['storefront']->id)
            ->update([
                'active_version_id' => $originalActiveId,
                'compatibility_working_version_id' => $originalActiveId,
                'draft_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
                'draft_revision' => 2,
                'draft_schema_version' => StorefrontPresentationNormalizer::VERSION,
                'published_config' => json_encode(['version' => 2, 'themePreset' => 'navy']),
                'published_revision' => 2,
                'published_schema_version' => StorefrontPresentationNormalizer::VERSION,
                'published_at' => now(),
            ]);

        // عميل قديم يعدّل — يُشوَّك بدل تعديل النسخة النشطة.
        $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => 2, 'themePreset' => 'burgundy'],
            'draft_revision' => 2,
        ])->assertOk();

        $afterFork = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seeded['storefront']->id)->first();
        $forkId = $afterFork->compatibility_working_version_id;
        $this->assertNotSame($originalActiveId, $forkId);
        $this->assertSame($originalActiveId, $afterFork->active_version_id, 'النشر لم يحدث بعد — النسخة النشطة تبقى القديمة حتى النشر.');

        // الآن ينشر العميل القديم — يجب أن يصبح الفرع (نسخة العمل الحالية) هو النشط.
        $token->postJson($this->legacyPublishPath($seeded['storefront']->id), [])->assertOk();

        $afterPublish = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seeded['storefront']->id)->first();
        $this->assertSame($forkId, $afterPublish->active_version_id, 'النشر القديم يجب أن يرقّي نسخة العمل الحالية إلى نشطة.');
        $this->assertSame('burgundy', $afterPublish->published_config['themePreset']);

        $promoted = StorefrontPresentationVersion::withoutGlobalScopes()->find($forkId);
        $this->assertNotNull($promoted->last_published_at, 'النسخة المُرقّاة يجب أن تحمل ختم نشر.');
        $this->assertSame('burgundy', $promoted->config['themePreset']);

        $oldActive = StorefrontPresentationVersion::withoutGlobalScopes()->find($originalActiveId);
        $this->assertSame('navy', $oldActive->config['themePreset'], 'النسخة النشطة السابقة يجب أن تبقى دون تعديل.');
    }

    /** @test */
    public function first_legacy_save_on_a_brand_new_storefront_materializes_a_compatibility_version(): void
    {
        $auth = $this->registerTenant('legacy-first-save-materializes', 'owner@legacy-first-save-materializes.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        // GET أولاً — يجب ألا يُنشئ شيئاً (سلوك الحالة A الأصلي محفوظ).
        $token->getJson($this->legacyPath($seeded['storefront']->id))->assertOk();
        $this->assertDatabaseCount('storefront_presentations', 0);

        // أول PUT فعلي على متجر بلا رأس إطلاقاً — يُنشئ الرأس ونسخة العمل معاً.
        $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'draft_revision' => 0,
        ])->assertOk();

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seeded['storefront']->id)->first();
        $this->assertNotNull($head->compatibility_working_version_id);

        $compat = StorefrontPresentationVersion::withoutGlobalScopes()->find($head->compatibility_working_version_id);
        $this->assertSame('navy', $compat->config['themePreset']);
        $this->assertSame(1, (int) $compat->revision);

        // نشر قديم لاحق يجب أن يرقّي هذه النسخة إلى نشطة، لا أن يترك
        // active_version_id فارغاً للأبد.
        $token->postJson($this->legacyPublishPath($seeded['storefront']->id), [])->assertOk();

        $afterPublish = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seeded['storefront']->id)->first();
        $this->assertSame($head->compatibility_working_version_id, $afterPublish->active_version_id);

        // وواجهة النسخ الجديدة تُظهر نسخة واحدة منشورة فعلاً — لا صفر.
        $list = $token->getJson($this->versionsPath($seeded['storefront']->id))->assertOk();
        $this->assertCount(1, $list->json('data'));
        $this->assertSame('published', $list->json('data.0.state'));
    }

    /** @test */
    public function saving_the_compatibility_version_through_the_new_api_syncs_legacy_draft_fields(): void
    {
        $auth = $this->registerTenant('version-api-syncs-legacy', 'owner@version-api-syncs-legacy.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'draft_revision' => 0,
        ])->assertOk();

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seeded['storefront']->id)->first();
        $compatId = $head->compatibility_working_version_id;

        // تعديل عبر واجهة النسخ الجديدة على نفس نسخة العمل المتوافقة.
        $token->putJson($this->versionsPath($seeded['storefront']->id).'/'.$compatId, [
            'config' => ['version' => 2, 'themePreset' => 'sand'],
            'revision' => 1,
        ])->assertOk();

        // GET القديم يجب أن يرى التعديل فوراً — لا يبقى خلف نسخة العمل.
        $legacyGet = $token->getJson($this->legacyPath($seeded['storefront']->id))->assertOk();
        $this->assertSame('sand', $legacyGet->json('data.draft.themePreset'));
        $this->assertSame(2, $legacyGet->json('data.draft_revision'));

        $refreshedHead = StorefrontPresentation::withoutGlobalScopes()->find($head->id);
        $this->assertSame(2, (int) $refreshedHead->draft_revision);
        $this->assertSame('sand', $refreshedHead->draft_config['themePreset']);
    }

    /** @test */
    public function legacy_publish_fails_closed_when_the_compatibility_version_itself_carries_a_forward_schema(): void
    {
        $auth = $this->registerTenant('legacy-publish-forward-compat', 'owner@legacy-publish-forward-compat.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'draft_revision' => 0,
        ])->assertOk();

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seeded['storefront']->id)->first();

        // حافة دفاعية: النسخة تحمل وسماً أحدث بينما وسم الرأس ما يزال
        // مدعوماً (لا يُفترض بلوغها عبر الكود الحالي بعد إصلاح المزامنة
        // الثنائية، لكن النشر يجب أن يفشل آمناً لو حدثت مستقبلاً).
        DB::table('storefront_presentation_versions')
            ->where('id', $head->compatibility_working_version_id)
            ->update(['schema_version' => StorefrontPresentationNormalizer::VERSION + 1]);

        $token->postJson($this->legacyPublishPath($seeded['storefront']->id), [])->assertStatus(409);

        $unchanged = StorefrontPresentation::withoutGlobalScopes()->find($head->id);
        $this->assertNull($unchanged->published_config);
    }

    /** @test */
    public function renaming_the_compatibility_version_keeps_the_legacy_draft_revision_in_sync(): void
    {
        $auth = $this->registerTenant('rename-syncs-legacy-revision', 'owner@rename-syncs-legacy-revision.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'draft_revision' => 0,
        ])->assertOk();

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seeded['storefront']->id)->first();
        $compatId = $head->compatibility_working_version_id;

        $token->patchJson($this->versionsPath($seeded['storefront']->id).'/'.$compatId, [
            'name' => 'اسم جديد',
            'revision' => 1,
        ])->assertOk();

        $refreshedHead = StorefrontPresentation::withoutGlobalScopes()->find($head->id);
        $this->assertSame(2, (int) $refreshedHead->draft_revision, 'draft_revision يجب أن يتزامن مع مراجعة النسخة بعد إعادة التسمية.');

        // مراجعة قديمة (1) أصبحت الآن فعلاً قديمة — يجب أن تُرفض.
        $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => 2, 'themePreset' => 'burgundy'],
            'draft_revision' => 1,
        ])->assertStatus(409);

        // المراجعة الصحيحة (2) تنجح.
        $token->putJson($this->legacyPath($seeded['storefront']->id), [
            'config' => ['version' => 2, 'themePreset' => 'burgundy'],
            'draft_revision' => 2,
        ])->assertOk();
    }

    /** @test */
    public function draft_only_edits_do_not_change_how_a_migrated_v1_published_snapshot_is_normalized(): void
    {
        $auth = $this->registerTenant('v1-publish-isolation', 'owner@v1-publish-isolation.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        // منشور v1 ناقص الأقسام (قسم "hero" فقط) + مسودة v1 مختلفة قليلاً
        // (Case C: منشور != مسودة، فتُهاجَران إلى نسختين منفصلتين).
        $v1Published = ['homepage' => ['sections' => [['key' => 'hero', 'visible' => true]]]];
        $v1Draft = ['homepage' => ['sections' => [['key' => 'hero', 'visible' => true]]], 'themePreset' => 'navy'];

        $rowId = $this->insertLegacyRow($seeded['storefront'], [
            'schema_version' => 1,
            'draft_config' => json_encode($v1Draft),
            'draft_revision' => 3,
            'published_config' => json_encode($v1Published),
            'published_revision' => 3,
            'published_at' => now(),
            'draft_schema_version' => 1,
            'published_schema_version' => 1,
        ]);

        $service = app(StorefrontPresentationService::class);

        // قبل أي تعديل: اللقطة المنشورة يجب أن تستعيد الأقسام الافتراضية
        // الناقصة (دلالة v1 الصحيحة تحت published_schema_version=1).
        $before = $service->publishedSnapshotForStorefront($seeded['storefront']->id);
        $beforeTypes = collect($before['homepage']['sections'])->pluck('type')->sort()->values()->all();
        $this->assertGreaterThan(1, count($beforeTypes), 'دلالة v1 يجب أن تستعيد الأقسام الافتراضية الناقصة.');

        // GET يضمن نسخة العمل المتوافقة (نسخة المسودة وحدها — Case C).
        $token->getJson($this->legacyPath($seeded['storefront']->id))->assertOk();
        $head = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $compatId = $head->compatibility_working_version_id;
        $this->assertNotSame($head->active_version_id, $compatId);

        $compat = StorefrontPresentationVersion::withoutGlobalScopes()->find($compatId);

        // نعدّل المسودة عبر واجهة النسخ الجديدة — هذا يرفع `schema_version`
        // المشترك على الرأس إلى 2 (سلوك متعمَّد للمسودة)، لكن يجب ألا يمسّ
        // تفسير اللقطة المنشورة القائمة إطلاقاً.
        $token->putJson($this->versionsPath($seeded['storefront']->id).'/'.$compatId, [
            'config' => ['version' => 2, 'themePreset' => 'sand'],
            'revision' => (int) $compat->revision,
        ])->assertOk();

        $refreshedHead = StorefrontPresentation::withoutGlobalScopes()->find($rowId);
        $this->assertSame(2, (int) $refreshedHead->schema_version, 'تأكيد أن العمود المشترك تقدّم فعلاً — هذا هو السيناريو المطلوب اختباره.');
        $this->assertSame(1, (int) $refreshedHead->published_schema_version, 'وسم المنشور المستقل يجب ألا يتأثر بحفظ مسودة.');

        $after = $service->publishedSnapshotForStorefront($seeded['storefront']->id);
        $afterTypes = collect($after['homepage']['sections'])->pluck('type')->sort()->values()->all();
        $this->assertSame($beforeTypes, $afterTypes, 'حفظ مسودة عبر واجهة النسخ يجب ألا يغيّر دلالة تطبيع اللقطة المنشورة القائمة.');
    }
}
