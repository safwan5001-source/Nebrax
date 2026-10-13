<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use App\Models\StorefrontPresentationVersionRevision;
use App\Services\Commerce\StorefrontPresentationVersionService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CUST-H5-6 — التحقق المتكامل لدورة حياة السجل المحفوظ مع الجدولة والنشر والاسترداد، كمنتجٍ واحد لا كوحدات منفصلة.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationHistoryLifecycleTest
 */
class StorefrontPresentationHistoryLifecycleTest extends TestCase
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

    private function seedStorefront(string $tenantId): Storefront
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create([
            'slug' => 'main',
            'name' => 'المتجر',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return $storefront;
    }

    private function rows(string $versionId)
    {
        return StorefrontPresentationVersionRevision::withoutGlobalScopes()
            ->where('version_id', $versionId)
            ->orderBy('version_revision')
            ->get();
    }

    private function theme(string $versionId): string
    {
        return StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->config['themePreset'];
    }

    /** @test */
    public function the_whole_lifecycle_save_schedule_publish_then_recover_leaves_history_and_published_consistent(): void
    {
        $auth = $this->registerTenant('h5-lifecycle', 'owner@h5-lifecycle.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $client = $this->withToken($auth['token']);
        $sf = $storefront->id;

        // ١) نسخة مسودة وثلاث حفظات متتالية — كل حفظ يتقدّم بمراجعة النسخة الحالية.
        $created = $client->postJson($this->versionsPath($sf), ['name' => 'الموسم'])->assertCreated();
        $versionId = $created->json('data.id');
        $revision = (int) $created->json('data.revision');
        foreach (['burgundy', 'navy', 'sand'] as $theme) {
            $saved = $client->putJson($this->itemPath($sf, $versionId), [
                'config' => ['version' => 2, 'themePreset' => $theme],
                'revision' => $revision,
            ])->assertOk();
            $revision = (int) $saved->json('data.revision');
        }
        $rowsBefore = $this->rows($versionId);
        $this->assertGreaterThanOrEqual(3, $rowsBefore->count());
        $revisionsListed = $client->getJson($this->itemPath($sf, $versionId).'/revisions')->assertOk()->json('data');
        $this->assertTrue($revisionsListed[0]['is_current'], 'الأحدث أولاً وهو الحالي.');

        // ٢) جدولة ثم نشر مجدول مستحق: النشر ليس حفظ محتوى فلا لقطة جديدة.
        $detail = $client->getJson($this->itemPath($sf, $versionId))->assertOk();
        $client->putJson($this->itemPath($sf, $versionId).'/schedule', [
            'revision' => $detail->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addMinutes(10)->toIso8601String(),
            'expected_schedule_token' => $detail->json('data.schedule_token'),
        ])->assertOk();
        DB::table('storefront_presentation_versions')->where('id', $versionId)->update(['scheduled_for' => Carbon::now('UTC')->subMinute()]);
        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $sf,
            $versionId,
            (int) StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->schedule_generation,
        );
        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_PUBLISHED, $outcome);
        $this->assertCount($rowsBefore->count(), $this->rows($versionId), 'النشر المجدول لا يسجّل لقطة.');
        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $sf)->first();
        $this->assertSame($versionId, $head->active_version_id);
        $publishedTheme = $this->theme($versionId);
        $this->assertSame('sand', $publishedTheme);

        // ٣) المنشورة غير قابلة للتعديل ولا تسجّل شيئاً، وسجلّها يبقى مقروءاً.
        $client->putJson($this->itemPath($sf, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'slate'],
            'revision' => (int) StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->revision,
        ])->assertStatus(409);
        $this->assertCount($rowsBefore->count(), $this->rows($versionId));
        $oldest = $this->rows($versionId)->first();
        $this->assertNotSame('sand', $oldest->config['themePreset'] ?? null, 'لقطة أقدم تحمل محتوى أقدم.');

        // ٤) الاسترداد من المنشورة = مسودة جديدة بمعرّف جديد من اللقطة؛ المنشورة والرأس لا يتغيّران.
        $publishedRevisionBefore = (int) StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->revision;
        $draft = $client->postJson($this->versionsPath($sf), [
            'name' => 'من لقطة',
            'source_version_id' => $versionId,
            'source_revision_id' => $oldest->id,
        ])->assertCreated();
        $draftId = $draft->json('data.id');
        $this->assertNotSame($versionId, $draftId);
        $this->assertSame('draft', $draft->json('data.state'));
        $this->assertSame($oldest->config['themePreset'] ?? null, $draft->json('data.config.themePreset'));
        $this->assertSame($publishedRevisionBefore, (int) StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->revision, 'الاسترداد لا يعيد مراجعة المنشورة.');
        $this->assertSame('sand', $this->theme($versionId));
        $headAfter = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $sf)->first();
        $this->assertSame($versionId, $headAfter->active_version_id);
        $this->assertSame($head->published_revision, $headAfter->published_revision);

        // ٥) تعديل المسودة الجديدة يسجَّل في سجلّها هي فقط، بمراجعتها هي.
        $client->putJson($this->itemPath($sf, $draftId), [
            'config' => ['version' => 2, 'themePreset' => 'slate'],
            'revision' => (int) $draft->json('data.revision'),
        ])->assertOk();
        $this->assertGreaterThanOrEqual(1, $this->rows($draftId)->count());
        $this->assertCount($rowsBefore->count(), $this->rows($versionId), 'سجلّ المنشورة لم يتأثر.');
    }

    /** @test */
    public function a_foreign_tenant_cannot_recover_from_this_history_even_through_the_create_path(): void
    {
        $owner = $this->registerTenant('h5-own', 'owner@h5-own.test');
        $ownerStorefront = $this->seedStorefront($owner['tenant_id']);
        $ownerClient = $this->withToken($owner['token']);
        $versionId = $ownerClient->postJson($this->versionsPath($ownerStorefront->id), ['name' => 'خاصة'])->assertCreated()->json('data.id');
        $detail = $ownerClient->getJson($this->itemPath($ownerStorefront->id, $versionId))->assertOk();
        $ownerClient->putJson($this->itemPath($ownerStorefront->id, $versionId), [
            'config' => ['version' => 2, 'themePreset' => 'navy'],
            'revision' => $detail->json('data.revision'),
        ])->assertOk();
        $revisionId = $this->rows($versionId)->first()->id;

        $other = $this->registerTenant('h5-other', 'owner@h5-other.test');
        $otherStorefront = $this->seedStorefront($other['tenant_id']);
        $otherClient = $this->withToken($other['token']);
        $otherVersion = $otherClient->postJson($this->versionsPath($otherStorefront->id), ['name' => 'أخرى'])->assertCreated()->json('data.id');

        // معرّف لقطة مستأجر آخر: عبر نسخته هو أو عبر نسخة الآخر — كلاهما 404، ولا نسخة تُنشأ.
        $before = StorefrontPresentationVersion::withoutGlobalScopes()->count();
        $otherClient->postJson($this->versionsPath($otherStorefront->id), [
            'name' => 'سرقة',
            'source_version_id' => $otherVersion,
            'source_revision_id' => $revisionId,
        ])->assertNotFound();
        $otherClient->postJson($this->versionsPath($otherStorefront->id), [
            'name' => 'سرقة',
            'source_version_id' => $versionId,
            'source_revision_id' => $revisionId,
        ])->assertNotFound();
        $this->assertSame($before, StorefrontPresentationVersion::withoutGlobalScopes()->count());
    }
}
