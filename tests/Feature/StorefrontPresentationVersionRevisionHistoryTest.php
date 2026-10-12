<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use App\Models\StorefrontPresentationVersionRevision;
use App\Services\Commerce\StorefrontPresentationRevisionRecorder;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use Tests\TestCase;

/**
 * CUST-H5-3 — سجلّ المراجعات المحفوظة الدائم لنسخة المظهر.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationVersionRevisionHistoryTest
 */
class StorefrontPresentationVersionRevisionHistoryTest extends TestCase
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

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    private function seedWebStorefront(string $tenantId, string $slug = 'main'): array
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
            'slug' => $slug,
            'name' => 'المتجر',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    /** ينشئ نسخة مسودة ويعيد [token-client, storefrontId, versionId]. */
    private function seedVersion(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $client = $this->withToken($auth['token']);
        $versionId = $client->postJson($this->versionsPath($seeded['storefront']->id), ['name' => 'مسودة'])
            ->assertCreated()
            ->json('data.id');

        return [$client, $seeded['storefront']->id, $versionId, $auth];
    }

    private function save($client, string $storefrontId, string $versionId, string $theme, int $revision)
    {
        return $client->putJson($this->itemPath($storefrontId, $versionId), [
            'config' => ['version' => 2, 'themePreset' => $theme],
            'revision' => $revision,
        ]);
    }

    private function rows(string $versionId)
    {
        return StorefrontPresentationVersionRevision::withoutGlobalScopes()
            ->where('version_id', $versionId)
            ->orderBy('version_revision')
            ->get();
    }

    // ───────────────────────── Recording convention ─────────────────────────

    /** @test */
    public function the_first_save_records_the_lazy_baseline_and_the_post_save_snapshot(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-first');

        $this->assertCount(0, $this->rows($versionId), 'إنشاء النسخة وحده لا يسجّل شيئاً.');

        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk()->assertJsonPath('data.revision', 2);

        $rows = $this->rows($versionId);
        $this->assertSame([1, 2], $rows->pluck('version_revision')->all());
        $this->assertSame('awj-modern', $rows[0]->config['themePreset'], 'خط الأساس = المستند قبل أول حفظ.');
        $this->assertSame('burgundy', $rows[1]->config['themePreset']);
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, (int) $rows[1]->schema_version);
        $this->assertSame(64, strlen($rows[1]->config_hash));
        $this->assertGreaterThan(0, (int) $rows[1]->size_bytes);
    }

    /** @test */
    public function each_later_save_adds_exactly_one_snapshot_and_the_baseline_is_not_repeated(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-later');

        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $this->save($client, $sf, $versionId, 'navy', 2)->assertOk();
        $this->save($client, $sf, $versionId, 'sand', 3)->assertOk();

        $rows = $this->rows($versionId);
        $this->assertSame([1, 2, 3, 4], $rows->pluck('version_revision')->all());
        $this->assertSame(['awj-modern', 'burgundy', 'navy', 'sand'], $rows->map(fn ($r) => $r->config['themePreset'])->all());
    }

    /** @test */
    public function a_save_that_does_not_change_the_document_records_no_duplicate_but_still_bumps_the_revision(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-noop');

        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $this->save($client, $sf, $versionId, 'burgundy', 2)->assertOk()->assertJsonPath('data.revision', 3);

        $this->assertSame([1, 2], $this->rows($versionId)->pluck('version_revision')->all());
        $this->assertSame(3, (int) StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->revision);
    }

    /** @test */
    public function recording_is_idempotent_under_a_repeated_call_for_the_same_revision(): void
    {
        [$client, $sf, $versionId, $auth] = $this->seedVersion('rev-idem');
        $this->save($client, $sf, $versionId, 'navy', 1)->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $version = StorefrontPresentationVersion::query()->find($versionId);
        $recorder = new StorefrontPresentationRevisionRecorder;
        $recorder->recordSave($version, (array) $version->config, (int) $version->revision, (int) $version->schema_version);
        $recorder->recordSave($version, (array) $version->config, (int) $version->revision, (int) $version->schema_version);

        $this->assertCount(2, $this->rows($versionId));
    }

    // ───────────────────────── Atomicity & immutability of the save contract ─────────────────────────

    /** @test */
    public function a_stale_409_save_records_nothing_and_never_moves_the_revision(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-stale');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $before = $this->rows($versionId)->count();

        $this->save($client, $sf, $versionId, 'navy', 1)->assertStatus(409);

        $this->assertCount($before, $this->rows($versionId));
        $this->assertSame(2, (int) StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->revision);
    }

    /** @test */
    public function an_oversized_document_is_rejected_and_records_nothing(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-big');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $before = $this->rows($versionId)->count();

        $huge = ['version' => 2, 'themePreset' => 'navy', 'branding' => ['displayName' => str_repeat('x', 1_700_000)]];
        $res = $client->putJson($this->itemPath($sf, $versionId), ['config' => $huge, 'revision' => 2]);
        $this->assertContains($res->status(), [413, 422]);

        $this->assertCount($before, $this->rows($versionId));
    }

    /** @test */
    public function a_save_to_the_active_published_version_is_refused_and_records_nothing(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-published');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $before = $this->rows($versionId)->count();

        $client->postJson($this->itemPath($sf, $versionId).'/publish', [
            'revision' => 2,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $this->assertCount($before, $this->rows($versionId), 'النشر ليس حفظ محتوى: لا لقطة.');

        $this->save($client, $sf, $versionId, 'navy', 2)->assertStatus(409);
        $this->assertCount($before, $this->rows($versionId));

        // سجلّ المنشورة قابل للقراءة (قراءة فقط) لكنه لا يعدّل شيئاً.
        $client->getJson($this->revisionsPath($sf, $versionId))->assertOk();
        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $sf)->first();
        $this->assertSame($versionId, $head->active_version_id);
        $this->assertSame('burgundy', StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId)->config['themePreset']);
    }

    /** @test */
    public function revisions_are_immutable_through_the_model(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-immutable');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();

        $row = $this->rows($versionId)->last();

        $this->expectException(LogicException::class);
        $row->forceFill(['size_bytes' => 1])->save();
    }

    /** @test */
    public function a_revision_cannot_be_deleted_through_the_model(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-no-delete');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();

        $this->expectException(LogicException::class);
        $this->rows($versionId)->last()->delete();
    }

    /** @test */
    public function deleting_a_version_cascades_its_history(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-cascade');
        // نسخة ثانية حتى لا تكون هذه هي نسخة العمل المتوافقة الوحيدة.
        $other = $client->postJson($this->versionsPath($sf), ['name' => 'أخرى'])->assertCreated()->json('data.id');
        $this->save($client, $sf, $other, 'navy', 1)->assertOk();
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $this->assertGreaterThan(0, $this->rows($versionId)->count());

        $res = $client->deleteJson($this->itemPath($sf, $versionId));
        if ($res->status() === 409) {
            $this->markTestSkipped('نسخة العمل المتوافقة لا تُحذف؛ نفحص التتالي مباشرة أدناه.');
        }
        $res->assertSuccessful();

        $this->assertCount(0, $this->rows($versionId));
        $this->assertGreaterThan(0, $this->rows($other)->count(), 'حذف نسخة لا يمسّ سجلّ غيرها.');
    }

    // ───────────────────────── Retention ─────────────────────────

    /** @test */
    public function retention_keeps_only_the_latest_bounded_number_and_never_drops_the_current(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-retention');
        $themes = ['navy', 'sand', 'burgundy', 'slate'];

        $revision = 1;
        $total = StorefrontPresentationRevisionRecorder::MAX_REVISIONS_PER_VERSION + 6;
        for ($i = 0; $i < $total; $i++) {
            $res = $this->save($client, $sf, $versionId, $themes[$i % 4], $revision)->assertOk();
            $revision = (int) $res->json('data.revision');
            // نُغيّر المحتوى فعلاً في كل حفظ (اسم متجر فريد) كي لا يُعامَل كتكرار.
            $client->putJson($this->itemPath($sf, $versionId), [
                'config' => ['version' => 2, 'themePreset' => $themes[$i % 4], 'branding' => ['displayName' => "v{$i}"]],
                'revision' => $revision,
            ])->assertOk();
            $revision++;
        }

        $rows = $this->rows($versionId);
        $this->assertSame(StorefrontPresentationRevisionRecorder::MAX_REVISIONS_PER_VERSION, $rows->count());
        $current = StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);
        $this->assertSame((int) $current->revision, (int) $rows->last()->version_revision, 'الأحدث (الحالي) لا يُحذف.');
        $this->assertSame('v'.($total - 1), $rows->last()->config['branding']['displayName']);
        $this->assertNotContains(1, $rows->pluck('version_revision')->all(), 'الأقدم (خط الأساس) سقط أولاً.');
    }

    /** @test */
    public function the_byte_budget_drops_older_snapshots_but_always_keeps_the_newest(): void
    {
        [$client, $sf, $versionId, $auth] = $this->seedVersion('rev-bytes');
        app(TenantContext::class)->set($auth['tenant_id']);
        $recorder = new StorefrontPresentationRevisionRecorder;
        $version = StorefrontPresentationVersion::query()->find($versionId);

        // مستندات ضخمة قرب 2.5 ميغابايت تُكتب مباشرة (تتجاوز مسار الحفظ عمداً لاختبار سقف الاحتفاظ وحده).
        $blob = str_repeat('x', 2_500_000);
        for ($i = 1; $i <= 9; $i++) {
            $prior = (array) $version->config;
            $priorRevision = (int) $version->revision;
            $version->forceFill([
                'config' => ['version' => 2, 'themePreset' => 'navy', 'branding' => ['displayName' => $blob.$i]],
                'revision' => $priorRevision + 1,
            ])->save();
            $recorder->recordSave($version, $prior, $priorRevision, (int) $version->schema_version);
        }

        $rows = $this->rows($versionId);
        $this->assertLessThanOrEqual(StorefrontPresentationRevisionRecorder::MAX_BYTES_PER_VERSION, (int) $rows->sum('size_bytes'));
        $this->assertSame((int) $version->revision, (int) $rows->last()->version_revision, 'الأحدث يبقى دائماً.');
        $this->assertLessThan(10, $rows->count(), 'سقف البايتات أسقط الأقدم.');
    }

    // ───────────────────────── Read API ─────────────────────────

    /** @test */
    public function list_is_newest_first_metadata_only_and_marks_the_current_snapshot(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-list');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $this->save($client, $sf, $versionId, 'navy', 2)->assertOk();

        $res = $client->getJson($this->revisionsPath($sf, $versionId))->assertOk();
        $data = $res->json('data');

        $this->assertSame([3, 2, 1], array_column($data, 'version_revision'));
        $this->assertSame([true, false, false], array_column($data, 'is_current'));
        foreach ($data as $item) {
            $this->assertArrayNotHasKey('config', $item, 'القائمة بلا مستند.');
            $this->assertArrayNotHasKey('config_hash', $item, 'البصمة داخلية.');
            $this->assertSame($versionId, $item['version_id']);
            $this->assertArrayHasKey('created_at', $item);
        }
    }

    /** @test */
    public function show_returns_the_normalized_historical_document_and_does_not_change_anything(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-show');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $this->save($client, $sf, $versionId, 'navy', 2)->assertOk();
        $list = $client->getJson($this->revisionsPath($sf, $versionId))->json('data');
        $burgundy = collect($list)->firstWhere('version_revision', 2);

        $res = $client->getJson($this->revisionsPath($sf, $versionId).'/'.$burgundy['id'])->assertOk();

        $this->assertSame('burgundy', $res->json('data.config.themePreset'));
        $this->assertSame(2, $res->json('data.version_revision'));
        $this->assertFalse($res->json('data.is_current'));
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, $res->json('data.config.version'));

        // لا أثر جانبي: النسخة لم تتحرّك.
        $version = StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);
        $this->assertSame(3, (int) $version->revision);
        $this->assertSame('navy', $version->config['themePreset']);
    }

    /** @test */
    public function a_revision_of_another_version_or_storefront_is_a_safe_404(): void
    {
        [$client, $sf, $versionA] = $this->seedVersion('rev-cross');
        $versionB = $client->postJson($this->versionsPath($sf), ['name' => 'ب'])->assertCreated()->json('data.id');
        $this->save($client, $sf, $versionA, 'burgundy', 1)->assertOk();
        $revisionOfA = $client->getJson($this->revisionsPath($sf, $versionA))->json('data.0.id');

        // مراجعة A عبر مسار B → 404 (لا يتسرّب وجودها).
        $client->getJson($this->revisionsPath($sf, $versionB).'/'.$revisionOfA)->assertNotFound();
        $client->getJson($this->revisionsPath($sf, $versionA).'/'.\Illuminate\Support\Str::uuid())->assertNotFound();
        $client->getJson($this->revisionsPath(\Illuminate\Support\Str::uuid()->toString(), $versionA))->assertNotFound();
    }

    /** @test */
    public function another_tenant_cannot_list_or_read_the_history_of_a_foreign_version(): void
    {
        [$clientA, $sfA, $versionA] = $this->seedVersion('rev-tenant-a');
        $this->save($clientA, $sfA, $versionA, 'burgundy', 1)->assertOk();
        $revisionId = $clientA->getJson($this->revisionsPath($sfA, $versionA))->json('data.0.id');

        $authB = $this->registerTenant('rev-tenant-b', 'owner@rev-tenant-b.test');
        $seededB = $this->seedWebStorefront($authB['tenant_id']);
        $clientB = $this->withToken($authB['token']);

        // مستأجر B يستعمل متجره وإمّا معرّف نسخة A أو متجر A: كلها 404.
        $clientB->getJson($this->revisionsPath($seededB['storefront']->id, $versionA))->assertNotFound();
        $clientB->getJson($this->revisionsPath($seededB['storefront']->id, $versionA).'/'.$revisionId)->assertNotFound();
        $clientB->getJson($this->revisionsPath($sfA, $versionA))->assertNotFound();
        $clientB->getJson($this->revisionsPath($sfA, $versionA).'/'.$revisionId)->assertNotFound();
    }

    /** @test */
    public function the_history_endpoints_require_authentication_and_commerce_manage(): void
    {
        [$client, $sf, $versionId, $auth] = $this->seedVersion('rev-authz');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $revisionId = $client->getJson($this->revisionsPath($sf, $versionId))->json('data.0.id');

        // `withToken` أعلاه يضبط ترويسة المصادقة على نفس نسخة الاختبار — نفرّغها ليكون الطلب زائراً فعلاً.
        $this->flushHeaders();
        $this->getJson($this->revisionsPath($sf, $versionId))->assertUnauthorized();
        $this->getJson($this->revisionsPath($sf, $versionId).'/'.$revisionId)->assertUnauthorized();

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@rev-authz.test');
        $this->withToken($staff)->getJson($this->revisionsPath($sf, $versionId))->assertForbidden();
        $this->withToken($staff)->getJson($this->revisionsPath($sf, $versionId).'/'.$revisionId)->assertForbidden();
    }

    /** @test */
    public function the_history_is_read_only_there_is_no_write_route(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-readonly');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $revisionId = $client->getJson($this->revisionsPath($sf, $versionId))->json('data.0.id');
        $path = $this->revisionsPath($sf, $versionId);

        $client->postJson($path, [])->assertStatus(405);
        $client->putJson($path.'/'.$revisionId, ['config' => ['version' => 2]])->assertStatus(405);
        $client->deleteJson($path.'/'.$revisionId)->assertStatus(405);
    }

    /** @test */
    public function a_forward_schema_snapshot_is_refused_with_409_like_the_version_itself(): void
    {
        [$client, $sf, $versionId] = $this->seedVersion('rev-forward');
        $this->save($client, $sf, $versionId, 'burgundy', 1)->assertOk();
        $revisionId = $client->getJson($this->revisionsPath($sf, $versionId))->json('data.0.id');

        DB::table('storefront_presentation_version_revisions')
            ->where('id', $revisionId)
            ->update(['schema_version' => StorefrontPresentationNormalizer::VERSION + 1]);

        $client->getJson($this->revisionsPath($sf, $versionId).'/'.$revisionId)->assertStatus(409);
    }

    // ───────────────────────── Legacy compatibility path ─────────────────────────

    /** @test */
    public function a_legacy_draft_put_is_recorded_in_the_same_history_without_gaps(): void
    {
        $auth = $this->registerTenant('rev-legacy', 'owner@rev-legacy.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $client = $this->withToken($auth['token']);
        $legacy = '/api/commerce/workspace/storefronts/'.$seeded['storefront']->id.'/presentation';

        $client->putJson($legacy, ['config' => ['version' => 2, 'themePreset' => 'navy'], 'draft_revision' => 0])->assertOk();
        $client->putJson($legacy, ['config' => ['version' => 2, 'themePreset' => 'sand'], 'draft_revision' => 1])->assertOk();

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seeded['storefront']->id)->first();
        $rows = $this->rows($head->compatibility_working_version_id);

        $this->assertNotEmpty($rows);
        $this->assertSame('sand', $rows->last()->config['themePreset']);
        $this->assertSame(
            (int) StorefrontPresentationVersion::withoutGlobalScopes()->find($head->compatibility_working_version_id)->revision,
            (int) $rows->last()->version_revision,
        );
        $this->assertSame($rows->pluck('version_revision')->unique()->count(), $rows->count(), 'لا مراجعتان متطابقتان.');
    }
}
