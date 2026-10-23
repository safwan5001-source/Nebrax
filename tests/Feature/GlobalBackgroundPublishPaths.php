<?php

namespace Tests\Feature;

use App\Models\StorefrontPresentation;
use App\Services\Commerce\StorefrontPresentationVersionService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * P3-A-06 — shared harness for "the same rule on every publish path" tests of the global background:
 * legacy publish, immediate version publish, scheduling, and execution of a scheduled publish.
 *
 * The version paths run on one storefront and the legacy path on another (the legacy draft and the versions share a head).
 */
trait GlobalBackgroundPublishPaths
{
    protected function legacyPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    protected function listPath(string $id): string
    {
        return $this->legacyPath($id).'/versions';
    }

    protected function itemPath(string $id, string $versionId): string
    {
        return $this->listPath($id).'/'.$versionId;
    }

    protected function presentationHead(string $storefrontId): ?StorefrontPresentation
    {
        return StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $storefrontId)->first();
    }

    /** Publishes a navy snapshot as version A and returns what a rejection must leave untouched. */
    protected function publishNavy($token, string $storefrontId): array
    {
        $a = $token->postJson($this->listPath($storefrontId), ['name' => 'أ'])->assertCreated();
        $aId = $a->json('data.id');
        $token->putJson($this->itemPath($storefrontId, $aId), ['config' => ['version' => 2, 'themePreset' => 'navy'], 'revision' => 1])->assertOk();
        $token->postJson($this->itemPath($storefrontId, $aId).'/publish', [
            'revision' => 2,
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();
        $head = $this->presentationHead($storefrontId);

        return ['id' => $aId, 'config' => $head->published_config, 'at' => (string) $head->published_at, 'epoch' => (int) $head->schedule_epoch];
    }

    protected function assertSnapshotUntouched(string $storefrontId, array $previous, int $publishedRevision = 1): void
    {
        $head = $this->presentationHead($storefrontId);
        $this->assertSame($previous['id'], $head->active_version_id);
        $this->assertSame($publishedRevision, (int) $head->published_revision);
        $this->assertSame($previous['config'], $head->published_config);
        $this->assertSame($previous['at'], (string) $head->published_at);
        $this->assertArrayNotHasKey('background', $head->published_config);
    }

    /** Marks a version due, exactly as the scheduler's persisted hand-off does. */
    protected function makeDue(string $storefrontId, string $versionId): void
    {
        DB::table('storefront_presentation_versions')->where('id', $versionId)->update([
            'scheduled_for' => Carbon::now('UTC')->subMinute(),
            'schedule_generation' => 1,
        ]);
        $this->presentationHead($storefrontId)->forceFill(['scheduled_version_id' => $versionId])->save();
    }

    /** @return array{revision:int,scheduled_for:string,expected_schedule_token:string} */
    protected function scheduleBody($saved): array
    {
        return [
            'revision' => $saved->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addHour()->toIso8601String(),
            'expected_schedule_token' => $saved->json('data.schedule_token'),
        ];
    }

    /**
     * `$config` is refused with `$code` (at `$path`) on all four paths and nothing moves: the Published Snapshot, its
     * revision, the version revision, the schedule pointer and epoch.
     *
     * @param  array<string,mixed>  $config  top-level presentation config fragment (`background`, …)
     */
    protected function assertRejectedOnEveryPath($token, string $versionStoreId, string $legacyStoreId, array $config, string $code, string $path = 'background'): void
    {
        // legacy publish: the draft is saved, the publish is refused, nothing is published
        $legacy = $this->legacyPath($legacyStoreId);
        $token->putJson($legacy, ['config' => $config, 'draft_revision' => 0])->assertOk();
        $rejected = $token->postJson($legacy.'/publish', ['draft_revision' => 1])->assertStatus(422);
        $this->assertSame($code, $rejected->json("error_codes.{$path}"), 'legacy publish');
        $legacyHead = $this->presentationHead($legacyStoreId);
        $this->assertNull($legacyHead->published_config);
        $this->assertNull($legacyHead->published_revision);
        $this->assertSame(1, (int) $legacyHead->draft_revision, 'a rejection does not advance the draft');

        // version paths
        $previous = $this->publishNavy($token, $versionStoreId);
        $b = $token->postJson($this->listPath($versionStoreId), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $saved = $token->putJson($this->itemPath($versionStoreId, $bId), ['config' => $config, 'revision' => 1])->assertOk();

        $publishBody = ['revision' => 2, 'expected_published_revision' => 1, 'expected_active_version_id' => $previous['id']];
        $rejected = $token->postJson($this->itemPath($versionStoreId, $bId).'/publish', $publishBody)->assertStatus(422);
        $this->assertSame($code, $rejected->json("error_codes.{$path}"), 'immediate publish');
        $this->assertSnapshotUntouched($versionStoreId, $previous);
        $this->assertSame(2, (int) DB::table('storefront_presentation_versions')->where('id', $bId)->value('revision'), 'the version revision did not move');

        $rejected = $token->putJson($this->itemPath($versionStoreId, $bId).'/schedule', $this->scheduleBody($saved))->assertStatus(422);
        $this->assertSame($code, $rejected->json("error_codes.{$path}"), 'schedule');
        $head = $this->presentationHead($versionStoreId);
        $this->assertNull($head->scheduled_version_id);
        $this->assertSame($previous['epoch'], (int) $head->schedule_epoch);

        // execution of a scheduled publish that got past scheduling (scheduled before the policy, or edited around it)
        $this->makeDue($versionStoreId, $bId);
        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish($versionStoreId, $bId, 1);
        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_VALIDATION_REJECTED, $outcome, 'scheduled execution');
        $this->assertSnapshotUntouched($versionStoreId, $previous);
        $this->assertSame($bId, $this->presentationHead($versionStoreId)->scheduled_version_id, 'a rejection neither clears nor advances the schedule');
        $this->assertSame(1, (int) DB::table('storefront_presentation_versions')->where('id', $bId)->value('schedule_generation'));
    }

    /**
     * `$config` publishes on all four paths; returns the `background` of each resulting snapshot.
     *
     * @param  array<string,mixed>  $config
     * @return array<string, array<string,mixed>> path name ⇒ published `background`
     */
    protected function assertAcceptedOnEveryPath($token, string $versionStoreId, string $legacyStoreId, array $config): array
    {
        $published = [];

        $legacy = $this->legacyPath($legacyStoreId);
        $token->putJson($legacy, ['config' => $config, 'draft_revision' => 0])->assertOk();
        $token->postJson($legacy.'/publish', ['draft_revision' => 1])->assertOk();
        $published['legacy'] = $this->presentationHead($legacyStoreId)->published_config['background'];

        $previous = $this->publishNavy($token, $versionStoreId);
        $body = fn (int $revision, int $publishedRevision, string $activeId) => ['revision' => $revision, 'expected_published_revision' => $publishedRevision, 'expected_active_version_id' => $activeId];

        $b = $token->postJson($this->listPath($versionStoreId), ['name' => 'ب'])->assertCreated();
        $bId = $b->json('data.id');
        $token->putJson($this->itemPath($versionStoreId, $bId), ['config' => $config, 'revision' => 1])->assertOk();
        $token->postJson($this->itemPath($versionStoreId, $bId).'/publish', $body(2, 1, $previous['id']))->assertOk();
        $published['version'] = $this->presentationHead($versionStoreId)->published_config['background'];

        $c = $token->postJson($this->listPath($versionStoreId), ['name' => 'ج'])->assertCreated();
        $cId = $c->json('data.id');
        $saved = $token->putJson($this->itemPath($versionStoreId, $cId), ['config' => $config, 'revision' => 1])->assertOk();
        $token->putJson($this->itemPath($versionStoreId, $cId).'/schedule', $this->scheduleBody($saved))->assertOk();
        $this->assertSame($cId, $this->presentationHead($versionStoreId)->scheduled_version_id);
        $this->makeDue($versionStoreId, $cId);
        $this->assertSame(
            StorefrontPresentationVersionService::OUTCOME_PUBLISHED,
            app(StorefrontPresentationVersionService::class)->executeScheduledPublish($versionStoreId, $cId, 1),
            'scheduled execution',
        );
        $published['scheduled'] = $this->presentationHead($versionStoreId)->published_config['background'];

        return $published;
    }
}
