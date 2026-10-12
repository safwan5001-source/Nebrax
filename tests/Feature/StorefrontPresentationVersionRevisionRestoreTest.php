<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontMedia;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CUST-H5-4 — استرداد لقطة محفوظة: إعادة فحص الوسائط وقت القراءة، وإنشاء مسودة جديدة من لقطة (للنسخة المنشورة خاصةً)،
 * وأن الاسترداد لا يعيد عدّاد المراجعة ولا يمسّ المنشورة.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationVersionRevisionRestoreTest
 */
class StorefrontPresentationVersionRevisionRestoreTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function versionsPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/versions';
    }

    private function itemPath(string $id, string $versionId): string
    {
        return $this->versionsPath($id).'/'.$versionId;
    }

    private function revisionsPath(string $id, string $versionId): string
    {
        return $this->itemPath($id, $versionId).'/revisions';
    }

    /** @return array{0: object, 1: string, 2: string, 3: array} */
    private function seedVersion(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $client = $this->withToken($auth['token']);
        $versionId = $client->postJson($this->versionsPath($storefront->id), ['name' => 'مسودة'])->assertCreated()->json('data.id');

        return [$client, $storefront->id, $versionId, $auth];
    }

    private function makeMedia(string $tenantId, string $variantsState = StorefrontMedia::VARIANTS_READY, string $state = StorefrontMedia::STATE_ACTIVE): string
    {
        app(TenantContext::class)->set($tenantId);
        $media = StorefrontMedia::create([
            'tenant_id' => $tenantId,
            'kind' => 'image',
            'original_name' => 'logo.png',
            'mime' => 'image/png',
            'size' => 1234,
            'sha256' => hash('sha256', Str::uuid()->toString()),
            'width' => 400,
            'height' => 400,
            'alt_ar' => 'شعار',
            'alt_en' => 'Logo',
            'storage_key' => Str::random(20),
            'variants_state' => $variantsState,
            'state' => $state,
        ]);
        app(TenantContext::class)->forget();

        return $media->id;
    }

    private function save($client, string $sf, string $versionId, array $config, int $revision)
    {
        return $client->putJson($this->itemPath($sf, $versionId), ['config' => $config, 'revision' => $revision]);
    }

    private function logoConfig(string $theme, string $mediaId): array
    {
        return ['version' => 2, 'themePreset' => $theme, 'branding' => ['logoMedia' => ['mediaId' => $mediaId, 'decorative' => true]]];
    }

    /** يحفظ ثم يعيد معرّف لقطة بمراجعة محدّدة. */
    private function revisionIdFor($client, string $sf, string $versionId, int $versionRevision): string
    {
        $row = collect($client->getJson($this->revisionsPath($sf, $versionId))->assertOk()->json('data'))
            ->firstWhere('version_revision', $versionRevision);
        $this->assertNotNull($row, "لا لقطة بالمراجعة {$versionRevision}");

        return $row['id'];
    }

    // ───────────────────── media revalidation at read time ─────────────────────

    /** @test */
    public function a_snapshot_without_media_has_no_issues(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rst-nomedia');
        $this->save($client, $sf, $versionId, ['version' => 2, 'themePreset' => 'navy'], 1)->assertOk();

        $res = $client->getJson($this->revisionsPath($sf, $versionId).'/'.$this->revisionIdFor($client, $sf, $versionId, 2))->assertOk();

        $this->assertSame([], $res->json('data.media_issues'));
    }

    /** @test */
    public function a_snapshot_with_valid_media_has_no_issues_and_a_later_deleted_media_is_reported_missing(): void
    {
        [$client, $sf, $versionId, $auth] = $this->seedVersion('rst-deleted');
        $media = $this->makeMedia($auth['tenant_id']);
        $this->save($client, $sf, $versionId, $this->logoConfig('navy', $media), 1)->assertOk();
        $revisionId = $this->revisionIdFor($client, $sf, $versionId, 2);

        $this->assertSame([], $client->getJson($this->revisionsPath($sf, $versionId).'/'.$revisionId)->json('data.media_issues'));

        // التاجر يحذف الصورة لاحقاً: اللقطة القديمة تبقى، لكن الفحص الحالي يكشف المشكلة (لا إحياء ولا إخفاء).
        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontMedia::query()->whereKey($media)->update(['state' => StorefrontMedia::STATE_DELETED]);
        app(TenantContext::class)->forget();

        $issues = $client->getJson($this->revisionsPath($sf, $versionId).'/'.$revisionId)->assertOk()->json('data.media_issues');
        $this->assertCount(1, $issues);
        $this->assertSame('media_missing', $issues[0]['code']);
        $this->assertStringContainsString('logoMedia', $issues[0]['path']);
        // المستند نفسه لم يُعدَّل ولم يُحذف منه المرجع.
        $config = $client->getJson($this->revisionsPath($sf, $versionId).'/'.$revisionId)->json('data.config');
        $this->assertSame($media, $config['branding']['logoMedia']['mediaId']);
    }

    /** @test */
    public function media_owned_by_another_tenant_is_reported_missing_never_resolved(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rst-foreign-media');
        $other = $this->registerTenant('rst-foreign-media-b', 'owner@rst-foreign-media-b.test');
        $foreignMedia = $this->makeMedia($other['tenant_id']);

        $this->save($client, $sf, $versionId, $this->logoConfig('navy', $foreignMedia), 1)->assertOk();
        $issues = $client->getJson($this->revisionsPath($sf, $versionId).'/'.$this->revisionIdFor($client, $sf, $versionId, 2))->json('data.media_issues');

        $this->assertSame(['media_missing'], array_column($issues, 'code'));
    }

    /** @test */
    public function media_whose_variants_are_not_ready_is_reported_not_ready(): void
    {
        [$client, $sf, $versionId, $auth] = $this->seedVersion('rst-pending');
        $media = $this->makeMedia($auth['tenant_id'], StorefrontMedia::VARIANTS_PENDING);
        $this->save($client, $sf, $versionId, $this->logoConfig('navy', $media), 1)->assertOk();

        $issues = $client->getJson($this->revisionsPath($sf, $versionId).'/'.$this->revisionIdFor($client, $sf, $versionId, 2))->json('data.media_issues');

        $this->assertSame(['media_not_ready'], array_column($issues, 'code'));
    }

    // ───────────────────── restore never rewinds the revision ─────────────────────

    /** @test */
    public function restoring_a_snapshot_is_an_ordinary_save_against_the_current_revision(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rst-current-rev');
        $this->save($client, $sf, $versionId, ['version' => 2, 'themePreset' => 'burgundy'], 1)->assertOk();   // rev 2
        $this->save($client, $sf, $versionId, ['version' => 2, 'themePreset' => 'navy'], 2)->assertOk();       // rev 3
        $this->save($client, $sf, $versionId, ['version' => 2, 'themePreset' => 'sand'], 3)->assertOk();       // rev 4

        $old = $client->getJson($this->revisionsPath($sf, $versionId).'/'.$this->revisionIdFor($client, $sf, $versionId, 2))->assertOk();
        $this->assertSame('burgundy', $old->json('data.config.themePreset'));

        // الاسترداد = حفظ المستند التاريخي بمراجعة النسخة **الحالية** (4) — المراجعة التاريخية (2) لا تُقبل أبداً.
        $this->save($client, $sf, $versionId, $old->json('data.config'), 2)->assertStatus(409);
        $restored = $this->save($client, $sf, $versionId, $old->json('data.config'), 4)->assertOk();

        $this->assertSame(5, $restored->json('data.revision'), 'العدّاد يتقدّم ولا يُعاد للخلف.');
        $this->assertSame('burgundy', $restored->json('data.config.themePreset'));
        $this->assertContains(5, array_column($client->getJson($this->revisionsPath($sf, $versionId))->json('data'), 'version_revision'));
    }

    // ───────────────────── create a Draft from a snapshot ─────────────────────

    /** @test */
    public function a_draft_is_created_from_a_snapshot_with_the_snapshot_document_and_a_fresh_revision(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rst-create');
        $this->save($client, $sf, $versionId, ['version' => 2, 'themePreset' => 'burgundy'], 1)->assertOk();
        $this->save($client, $sf, $versionId, ['version' => 2, 'themePreset' => 'navy'], 2)->assertOk();
        $revisionId = $this->revisionIdFor($client, $sf, $versionId, 2);

        $res = $client->postJson($this->versionsPath($sf), [
            'name' => 'من لقطة',
            'source_version_id' => $versionId,
            'source_revision_id' => $revisionId,
        ])->assertCreated();

        $this->assertSame('burgundy', $res->json('data.config.themePreset'));
        $this->assertSame('draft', $res->json('data.state'));
        $this->assertSame(1, $res->json('data.revision'));
        $this->assertNotSame($versionId, $res->json('data.id'));
        $this->assertSame([], $res->json('data.media_issues'));
        // المصدر لم يتغيّر.
        $this->assertSame('navy', StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->config['themePreset']);
    }

    /** @test */
    public function creating_a_draft_from_a_published_versions_snapshot_never_mutates_the_published_state(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rst-published');
        $this->save($client, $sf, $versionId, ['version' => 2, 'themePreset' => 'burgundy'], 1)->assertOk();
        $this->save($client, $sf, $versionId, ['version' => 2, 'themePreset' => 'navy'], 2)->assertOk();
        $revisionId = $this->revisionIdFor($client, $sf, $versionId, 2);

        $client->postJson($this->itemPath($sf, $versionId).'/publish', [
            'revision' => 3,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();
        $headBefore = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $sf)->first()->only(['active_version_id', 'published_revision', 'published_config']);

        $res = $client->postJson($this->versionsPath($sf), [
            'name' => 'مسودة من المنشورة',
            'source_version_id' => $versionId,
            'source_revision_id' => $revisionId,
        ])->assertCreated();

        $this->assertSame('draft', $res->json('data.state'));
        $headAfter = StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);
        $this->assertSame('navy', $headAfter->config['themePreset']);
        $this->assertSame(3, (int) $headAfter->revision);
        $this->assertSame($headBefore, StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $sf)->first()->only(['active_version_id', 'published_revision', 'published_config']));
    }

    /** @test */
    public function a_draft_from_a_snapshot_reports_current_media_issues_without_altering_the_document(): void
    {
        [$client, $sf, $versionId, $auth] = $this->seedVersion('rst-create-media');
        $media = $this->makeMedia($auth['tenant_id']);
        $this->save($client, $sf, $versionId, $this->logoConfig('navy', $media), 1)->assertOk();
        $revisionId = $this->revisionIdFor($client, $sf, $versionId, 2);

        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontMedia::query()->whereKey($media)->update(['state' => StorefrontMedia::STATE_DELETED]);
        app(TenantContext::class)->forget();

        $res = $client->postJson($this->versionsPath($sf), [
            'name' => 'مع وسائط ناقصة',
            'source_version_id' => $versionId,
            'source_revision_id' => $revisionId,
        ])->assertCreated();

        $this->assertSame(['media_missing'], array_column($res->json('data.media_issues'), 'code'));
        $this->assertSame($media, $res->json('data.config.branding.logoMedia.mediaId'));
    }

    /** @test */
    public function a_revision_id_without_a_source_version_is_rejected(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rst-no-source');
        $this->save($client, $sf, $versionId, ['version' => 2, 'themePreset' => 'navy'], 1)->assertOk();
        $revisionId = $this->revisionIdFor($client, $sf, $versionId, 2);

        $client->postJson($this->versionsPath($sf), ['name' => 'x', 'source_revision_id' => $revisionId])->assertStatus(422);
    }

    /** @test */
    public function a_revision_of_another_version_or_tenant_or_a_random_id_is_a_safe_404_and_creates_nothing(): void
    {
        [$client, $sf, $versionA] = $this->seedVersion('rst-404-a');
        $versionB = $client->postJson($this->versionsPath($sf), ['name' => 'ب'])->assertCreated()->json('data.id');
        $this->save($client, $sf, $versionA, ['version' => 2, 'themePreset' => 'navy'], 1)->assertOk();
        $revisionOfA = $this->revisionIdFor($client, $sf, $versionA, 2);

        [$clientT, $sfT, $versionT] = $this->seedVersion('rst-404-b');
        $this->save($clientT, $sfT, $versionT, ['version' => 2, 'themePreset' => 'sand'], 1)->assertOk();
        $revisionOfT = $this->revisionIdFor($clientT, $sfT, $versionT, 2);

        $before = StorefrontPresentationVersion::withoutGlobalScopes()->count();
        // لقطة A مع المصدر B؛ لقطة مستأجر آخر؛ معرّف عشوائي.
        $client->postJson($this->versionsPath($sf), ['name' => 'x', 'source_version_id' => $versionB, 'source_revision_id' => $revisionOfA])->assertNotFound();
        $client->postJson($this->versionsPath($sf), ['name' => 'x', 'source_version_id' => $versionA, 'source_revision_id' => $revisionOfT])->assertNotFound();
        $client->postJson($this->versionsPath($sf), ['name' => 'x', 'source_version_id' => $versionA, 'source_revision_id' => (string) Str::uuid()])->assertNotFound();

        $this->assertSame($before, StorefrontPresentationVersion::withoutGlobalScopes()->count());
    }

    /** @test */
    public function unknown_create_keys_are_still_rejected(): void
    {
        [$client, $sf] = $this->seedVersion('rst-unknown');

        $client->postJson($this->versionsPath($sf), ['name' => 'x', 'config' => ['version' => 2]])->assertStatus(422);
    }
}
