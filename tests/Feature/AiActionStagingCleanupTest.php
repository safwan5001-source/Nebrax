<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionApproval;
use App\Models\AiActionExecution;
use App\Models\AiActionImage;
use App\Models\ProductMedia;
use App\Services\AiActionStagedImageRetention;
use App\Services\DocumentCenter\DocumentStorageService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use LogicException;
use RuntimeException;
use Tests\TestCase;
use ZipArchive;

/**
 * AI-ACTIONS-07: the lifecycle of the private staged images. Nothing a live approval, a running execution or a
 * repair window still needs is removed; nothing outside the staging layout is ever touched; final product images
 * are out of reach; and the job can be run any number of times.
 */
class AiActionStagingCleanupTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiProductActions;
    use InteractsWithWebhooks;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['document_center.storage.driver' => 'local', 'document_center.storage.disk' => 'local']);
        $this->bindWebhookValidator($this->fakeWebhookResolver());
    }

    private function png(int $rgb = 0xFF0000): string
    {
        $image = imagecreatetruecolor(8, 8);
        imagefill($image, 0, 0, $rgb);
        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }

    /** @param array<string,string> $entries */
    private function zip(array $entries): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'ai-cleanup-test-');
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($entries as $entry => $bytes) {
            $zip->addFromString($entry, $bytes);
        }
        $zip->close();

        return new UploadedFile($path, 'images.zip', 'application/zip', null, true);
    }

    private function stage(string $token, string $id, array $entries, int $version = 1, string $key = 'cl-arch-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)
            ->post("/api/ai-actions/{$id}/image-archives", ['expected_version' => $version, 'archive' => $this->zip($entries)], ['Accept' => 'application/json']);
    }

    private function draft(array $auth, string $sku = 'CL-1', string $key = 'cl-act-0001', int $rgb = 0xFF0000): string
    {
        $id = $this->makeAction($auth, [$this->good('a', 2, $sku)], $key);
        $this->stage($auth['token'], $id, [$sku.'.png' => $this->png($rgb)], 1, $key.'-zip')->assertCreated();

        return $id;
    }

    /** A draft taken through preview, approval and a completed execution. */
    private function executedDraft(array $auth, string $sku = 'EXE-1', string $key = 'cl-exe-0001'): string
    {
        $id = $this->draft($auth, $sku, $key);
        $preview = $this->preview($auth['token'], $id, 1, $key.'-pv')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, $key.'-ap')->assertCreated();
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', $key.'-ex')->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => 1])->assertCreated();

        return $id;
    }

    /** @return \Illuminate\Support\Collection<int,AiActionImage> */
    private function images(string $id)
    {
        return AiActionImage::withoutGlobalScopes()->where('ai_action_id', $id)->orderBy('id')->get();
    }

    private function exists(AiActionImage $image, bool $thumb = false): bool
    {
        return app(DocumentStorageService::class)->exists($image->storage_profile, $thumb ? (string) $image->thumb_key : $image->storage_key);
    }

    private function retention(): AiActionStagedImageRetention
    {
        return app(AiActionStagedImageRetention::class);
    }

    /** Makes everything the AI tables hold `$days` old (absolute, so calls do not accumulate). Tokens stay valid. */
    private function age(int $days, bool $lapseApprovals = true): void
    {
        $at = now()->subDays($days);
        if ($lapseApprovals) {
            DB::table('ai_action_approvals')->update(['expires_at' => $at->copy()->addHour()]);
        }
        DB::table('ai_actions')->update(['updated_at' => $at]);
        DB::table('ai_actions')->whereNotNull('cancelled_at')->update(['cancelled_at' => $at]);
        DB::table('ai_action_images')->update(['created_at' => $at]);
        DB::table('ai_action_events')->update(['occurred_at' => $at]);
        DB::table('ai_action_executions')->whereNotNull('finished_at')->update(['started_at' => $at, 'finished_at' => $at]);
    }

    /** Files that are not staging objects: the final product media and everything else. */
    private function nonStagingFiles(): array
    {
        return array_values(array_filter(Storage::disk('local')->allFiles(), static fn (string $f): bool => ! str_contains($f, 'ai-actions/')));
    }

    /** @test */
    public function an_expired_idle_draft_loses_its_staged_objects_and_a_recent_one_keeps_them(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $image = $this->images($id)->first();

        $this->age(10);
        $recent = $this->retention()->run();
        $this->assertSame(0, $recent['images']);
        $this->assertSame(1, $recent['skipped']['within_retention']);
        $this->assertTrue($this->exists($image) && $this->exists($image, true));

        $this->age(35); // 35 days idle > the 30 day default
        $result = $this->retention()->run();
        $this->assertSame(1, $result['actions']);
        $this->assertSame(1, $result['images']);
        $this->assertGreaterThan(0, $result['bytes']);
        $this->assertFalse($this->exists($image));
        $this->assertFalse($this->exists($image, true));
        $this->assertNotNull($image->fresh()->purged_at);
        // The evidence row stays (audit); only the bytes went.
        $this->assertSame(1, $this->images($id)->count());
    }

    /** @test */
    public function the_retention_windows_follow_the_action_state_and_cannot_be_set_below_their_floors(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $action = AiAction::withoutGlobalScopes()->findOrFail($id);

        $action->forceFill(['status' => AiAction::STATUS_CANCELLED, 'cancelled_at' => now()])->save();
        $this->assertSame('within_retention', $this->retention()->decide($action->fresh(), now('UTC'))['reason']);
        $this->age(2);
        $this->assertTrue($this->retention()->decide($action->fresh(), now('UTC'))['eligible'], 'cancelled: 1 day by default');

        // A failed run keeps its images for the repair window (30 days), a clean one for 7.
        $done = AiAction::withoutGlobalScopes()->findOrFail($this->executedDraft($auth, 'CL-2', 'cl-act-0002'));
        $this->age(8);
        $this->assertTrue($this->retention()->decide($done->fresh(), now('UTC'))['eligible'], 'executed: 7 days');
        DB::table('ai_actions')->where('id', $done->id)->update(['status' => AiAction::STATUS_PARTIALLY_FAILED]);
        $this->assertSame('within_retention', $this->retention()->decide($done->fresh(), now('UTC'))['reason'], 'failed: 30 days');
        $this->age(31);
        $this->assertTrue($this->retention()->decide($done->fresh(), now('UTC'))['eligible']);

        config(['ai_actions.staging_retention' => ['draft_days' => '0', 'cancelled_days' => '-3', 'executed_days' => 'abc', 'repairable_days' => 0]]);
        $this->assertSame(['draft_days' => 1, 'cancelled_days' => 1, 'executed_days' => 7, 'repairable_days' => 1], $this->retention()->days());
        config(['ai_actions.staging_retention' => ['draft_days' => '45', 'cancelled_days' => '0', 'executed_days' => 12, 'repairable_days' => '90']]);
        $this->assertSame(['draft_days' => 45, 'cancelled_days' => 0, 'executed_days' => 12, 'repairable_days' => 90], $this->retention()->days());
    }

    /** @test */
    public function nothing_a_live_approval_or_a_running_execution_needs_is_purged(): void
    {
        $auth = $this->registerTenant();
        config(['ai_actions.approval_ttl_minutes' => 60 * 24 * 90]);
        $id = $this->draft($auth);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview)->assertCreated();
        $image = $this->images($id)->first();

        $this->age(40, false); // far past the draft window, but the approval is still live
        $result = $this->retention()->run();
        $this->assertSame(0, $result['images']);
        $this->assertSame(1, $result['skipped']['approval_active']);
        $this->assertTrue($this->exists($image));

        // A running execution is never touched either — even once the approval is gone.
        AiActionApproval::withoutGlobalScopes()->where('ai_action_id', $id)->update(['revoked_at' => now()]);
        AiAction::withoutGlobalScopes()->whereKey($id)->update(['status' => AiAction::STATUS_EXECUTING]);
        $result = $this->retention()->run();
        $this->assertSame(0, $result['images']);
        $this->assertSame(1, $result['skipped']['running']);
        $this->assertTrue($this->exists($image) && $this->exists($image, true));
        $this->assertNull($image->fresh()->purged_at);
    }

    /** @test */
    public function final_product_images_are_never_reached_and_a_consumed_run_is_cleaned_after_its_window(): void
    {
        $auth = $this->registerTenant();
        $id = $this->executedDraft($auth, 'FIN-1');
        $this->assertSame(1, ProductMedia::withoutGlobalScopes()->count());
        $final = $this->nonStagingFiles();
        $this->assertNotEmpty($final, 'the product gallery has its own files');
        $image = $this->images($id)->first();

        $this->age(3); // executed: kept 7 days
        $this->assertSame(0, $this->retention()->run()['images']);
        $this->assertTrue($this->exists($image));

        $this->age(9);
        $this->assertSame(1, $this->retention()->run()['images']);
        $this->assertFalse($this->exists($image));
        $this->assertSame(1, ProductMedia::withoutGlobalScopes()->count());
        $this->assertSame($final, $this->nonStagingFiles(), 'final product media files are untouched');
    }

    /** @test */
    public function running_the_cleanup_twice_changes_nothing_the_second_time(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $this->age(35);

        $first = $this->retention()->run();
        $second = $this->retention()->run();

        $this->assertSame(1, $first['images']);
        $this->assertEquals(['images' => 0, 'actions' => 0, 'bytes' => 0, 'failed' => 0, 'unsafe' => 0], array_intersect_key($second, array_flip(['images', 'actions', 'bytes', 'failed', 'unsafe'])));
        $this->assertSame(1, $this->images($id)->whereNotNull('purged_at')->count());
        $this->assertSame(0, Artisan::call('ai-actions:purge-staged-images'));
    }

    /** @test */
    public function a_dry_run_counts_candidates_and_deletes_nothing(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $image = $this->images($id)->first();
        $this->age(35);

        $result = $this->retention()->run(true);
        $this->assertTrue($result['dry_run']);
        $this->assertSame(1, $result['images']);
        $this->assertSame((int) $image->size_bytes, $result['bytes']);
        $this->assertTrue($this->exists($image) && $this->exists($image, true));
        $this->assertNull($image->fresh()->purged_at);

        $this->assertSame(0, Artisan::call('ai-actions:purge-staged-images', ['--dry-run' => true]));
        $this->assertStringContainsString('[dry-run] ai-actions:purge-staged-images status=ok actions=1 images=1', Artisan::output());
        $this->assertNull($image->fresh()->purged_at);
    }

    /** @test */
    public function a_storage_failure_leaves_the_row_unpurged_and_the_next_run_finishes_the_job(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $image = $this->images($id)->first();
        $this->age(35);

        $real = app(DocumentStorageService::class);
        $down = true;
        $this->partialMock(DocumentStorageService::class, function ($mock) use ($real, &$down): void {
            $mock->shouldReceive('delete')->andReturnUsing(function (string $profile, string $key) use ($real, &$down): void {
                if ($down) {
                    throw new RuntimeException('object store down');
                }
                $real->delete($profile, $key);
            });
        });
        $result = $this->retention()->run();
        $this->assertSame(1, $result['failed']);
        $this->assertSame(0, $result['images']);
        $this->assertNull($image->fresh()->purged_at, 'nothing is claimed as removed');
        $this->assertSame(1, Artisan::call('ai-actions:purge-staged-images'), 'the command reports the failure');

        $down = false;
        $retry = $this->retention()->run();
        $this->assertSame(0, $retry['failed']);
        $this->assertSame(1, $retry['images']);
        $this->assertNotNull($image->fresh()->purged_at);
        $this->assertFalse($this->exists($image));
    }

    /** @test */
    public function keys_outside_the_staging_layout_are_never_deleted(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $image = $this->images($id)->first();
        $storage = app(DocumentStorageService::class);
        $other = '11111111-2222-4333-8444-555555555555';
        $foreign = [
            'ai-actions/'.$image->tenant_id.'/'.$id.'/images/../../../keep.txt',
            'ai-actions/'.$other.'/'.$id.'/images/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png',          // another tenant's path
            'ai-actions/'.$image->tenant_id.'/'.$other.'/images/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png', // another action
            'documents/'.$image->tenant_id.'/invoice.pdf',                                           // a foreign prefix
            "ai-actions/{$image->tenant_id}/{$id}/images/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png.x",   // a suffix the layout never writes
            "ai-actions/{$image->tenant_id}/{$id}/images/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png\\x", // a backslash
            '/etc/passwd',
        ];
        $canary = fopen('php://temp', 'r+b');
        fwrite($canary, 'keep');
        rewind($canary);
        $storage->put($image->storage_profile, 'documents/'.$image->tenant_id.'/invoice.pdf', $canary);
        $this->age(35);

        $before = $this->images($id)->count();
        foreach ($foreign as $bad) {
            AiActionImage::withoutGlobalScopes()->whereKey($image->id)->update(['storage_key' => $bad, 'thumb_key' => null]);
            $result = $this->retention()->run();
            $this->assertSame(1, $result['unsafe'], "unsafe: {$bad}");
            $this->assertSame(0, $result['images']);
            $this->assertNull(AiActionImage::withoutGlobalScopes()->find($image->id)->purged_at);
        }
        $this->assertTrue($storage->exists($image->storage_profile, 'documents/'.$image->tenant_id.'/invoice.pdf'));
        $this->assertSame($before, $this->images($id)->count());
        $this->assertSame(1, Artisan::call('ai-actions:purge-staged-images'), 'unsafe keys make the command fail loudly');
    }

    /** @test */
    public function the_cleanup_can_be_scoped_to_one_tenant_and_never_crosses_tenants(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $idA = $this->draft($a, 'CL-A', 'cl-act-000a');
        $b = $this->registerTenant('beta', 'owner@beta.test');
        $idB = $this->draft($b, 'CL-B', 'cl-act-000b');
        $this->age(35);

        $result = $this->retention()->run(false, $a['tenant_id']);
        $this->assertSame(1, $result['images']);
        $this->assertNotNull($this->images($idA)->first()->purged_at);
        $this->assertNull($this->images($idB)->first()->purged_at);
        $this->assertTrue($this->exists($this->images($idB)->first()));

        // A row of tenant A whose key points into tenant B is refused, not followed.
        $imageA = $this->images($idB)->first();
        AiActionImage::withoutGlobalScopes()->whereKey($imageA->id)->update(['storage_key' => str_replace($b['tenant_id'], $a['tenant_id'], $imageA->storage_key)]);
        $result = $this->retention()->run(false, $b['tenant_id']);
        $this->assertSame(1, $result['unsafe']);
    }

    /** @test */
    public function a_decision_is_retaken_under_the_action_lock_so_a_late_execution_or_approval_wins(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $image = $this->images($id)->first();
        $this->age(35);

        // The candidate list was read while the action was idle...
        $this->assertTrue($this->retention()->decide(AiAction::withoutGlobalScopes()->findOrFail($id), now('UTC'))['eligible']);
        // ...then an execution started before the purge got the lock.
        DB::table('ai_actions')->where('id', $id)->update(['status' => AiAction::STATUS_EXECUTING]);
        $result = $this->retention()->purgeAction($id);
        $this->assertSame('running', $result['reason']);
        $this->assertSame(0, $result['images']);
        $this->assertTrue($this->exists($image) && $this->exists($image, true));
        $this->assertNull($image->fresh()->purged_at);

        // Same for an approval granted in between: the scan saw an idle draft, then the reviewer approved it.
        DB::table('ai_actions')->where('id', $id)->update(['status' => AiAction::STATUS_CREATED]);
        $this->assertTrue($this->retention()->decide(AiAction::withoutGlobalScopes()->findOrFail($id), now('UTC'))['eligible']);
        $preview = $this->preview($auth['token'], $id, 1, 'cl-preview-0003')->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview, 1, 'cl-approve-0003')->assertCreated();
        $this->assertSame('approval_active', $this->retention()->purgeAction($id)['reason']);
        $this->assertTrue($this->exists($image));
        $this->assertNull($image->fresh()->purged_at);
    }

    /** @test */
    public function an_object_another_live_row_still_references_is_not_deleted(): void
    {
        $auth = $this->registerTenant();
        $stale = $this->draft($auth, 'CL-S', 'cl-act-000s');
        $old = $this->images($stale)->first();
        $this->age(35);

        // A newer, still-live action names the very same objects (a bad copy or a manual fix could do this).
        $fresh = $this->draft($auth, 'CL-F', 'cl-act-000f', 0x0000FF);
        $live = $this->images($fresh)->first();
        AiActionImage::withoutGlobalScopes()->whereKey($live->id)->update(['storage_key' => $old->storage_key, 'thumb_key' => $old->thumb_key]);

        $result = $this->retention()->purgeAction($stale);
        $this->assertSame(1, $result['images']);
        $this->assertNotNull($old->fresh()->purged_at);
        $this->assertTrue($this->exists($old) && $this->exists($old, true), 'the shared objects stay while a live row references them');

        // The sharing row itself is never purged through a key that is not its own.
        $this->age(35);
        $this->assertSame(1, $this->retention()->purgeAction($fresh)['unsafe']);
        $this->assertTrue($this->exists($old));
    }

    /** @test */
    public function a_purged_image_is_reported_explicitly_and_the_same_archive_can_be_uploaded_again(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth, 'CL-P');
        $image = $this->images($id)->first();
        $this->age(35);
        $this->retention()->run();

        $this->withToken($auth['token'])->get("/api/ai-actions/{$id}/images/{$image->id}/thumbnail")->assertStatus(410)->assertJsonPath('error.code', 'image_purged');
        $this->assertSame([], $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/images")->assertOk()->json('data.archive'));

        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->assertContains('image_archive_purged', array_column($preview['issues'], 'code'));
        $this->assertSame(0, $preview['images']['archive']['total']);

        // Re-uploading the very same ZIP is new evidence, not a replay of the purged one.
        $again = $this->stage($auth['token'], $id, ['CL-P.png' => $this->png(0xFF0000)], 1, 'cl-arch-0002')->assertCreated();
        $this->assertFalse($again->json('data.replayed') ?? false);
        $fresh = $this->images($id)->whereNull('purged_at');
        $this->assertCount(1, $fresh);
        $this->assertTrue($this->exists($fresh->first()));
        $preview = $this->preview($auth['token'], $id, 1, 'cl-preview-0002')->assertCreated()->json('data');
        $this->assertNotContains('image_archive_purged', array_column($preview['issues'], 'code'));
        $this->assertSame(1, $preview['images']['archive']['total']);
    }

    /** @test */
    public function the_purge_marker_is_the_only_change_an_image_row_ever_accepts_and_only_once(): void
    {
        $auth = $this->registerTenant();
        $image = $this->images($this->draft($auth))->first();

        try {
            $image->forceFill(['content_sha256' => str_repeat('0', 64)])->save();
            $this->fail('evidence is immutable');
        } catch (LogicException) {
        }
        $image = $image->fresh();
        $image->forceFill(['purged_at' => now()])->save();
        $this->assertTrue($image->fresh()->isPurged());
        foreach ([['purged_at' => null], ['purged_at' => now()->addDay()], ['purged_at' => now(), 'size_bytes' => 1]] as $change) {
            try {
                $image->fresh()->forceFill($change)->save();
                $this->fail('a purged row must stay as it is');
            } catch (LogicException) {
            }
        }
        try {
            $image->fresh()->delete();
            $this->fail('evidence rows are never deleted');
        } catch (LogicException) {
        }
    }

    /** @test */
    public function deleting_an_action_removes_its_staged_objects_but_never_while_they_are_needed(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $image = $this->images($id)->first();
        $action = AiAction::withoutGlobalScopes()->findOrFail($id);

        $action->forceFill(['status' => AiAction::STATUS_EXECUTING])->save();
        try {
            $action->fresh()->delete();
            $this->fail('an executing action cannot be deleted');
        } catch (LogicException) {
        }
        $this->assertTrue($this->exists($image) && $this->exists($image, true));
        $this->assertNotNull(AiAction::withoutGlobalScopes()->find($id));

        $action->forceFill(['status' => AiAction::STATUS_CANCELLED, 'cancelled_at' => now()])->save();
        $action->fresh()->delete();
        $this->assertFalse($this->exists($image));
        $this->assertFalse($this->exists($image, true));
        $this->assertNull(AiAction::withoutGlobalScopes()->find($id));
    }

    /** @test */
    public function a_failed_object_delete_stops_the_action_deletion_and_keeps_the_rows(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $action = AiAction::withoutGlobalScopes()->findOrFail($id);
        $action->forceFill(['status' => AiAction::STATUS_CANCELLED, 'cancelled_at' => now()])->save();

        $this->partialMock(DocumentStorageService::class, function ($mock): void {
            $mock->shouldReceive('delete')->andThrow(new RuntimeException('object store down'));
        });
        try {
            AiAction::withoutGlobalScopes()->findOrFail($id)->delete();
            $this->fail('the deletion must not proceed half-way');
        } catch (LogicException) {
        }
        $this->assertNotNull(AiAction::withoutGlobalScopes()->find($id));
        $this->assertSame(1, $this->images($id)->whereNull('purged_at')->count());
    }

    /** @test */
    public function the_operational_log_carries_counts_only(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth);
        $image = $this->images($id)->first();
        $this->age(35);

        Log::spy();
        $this->retention()->run();
        Log::shouldHaveReceived('info')->once()->withArgs(function (string $message, array $context) use ($image, $id, $auth): bool {
            $flat = json_encode($context);

            return $message === 'ai_actions.staged_images.cleanup'
                && ! str_contains($flat, $image->storage_key) && ! str_contains($flat, $id) && ! str_contains($flat, $auth['tenant_id'])
                && ($context['images'] ?? null) === 1;
        });
    }

    /** @test */
    public function an_image_purged_behind_an_approval_is_never_attached_as_if_it_still_existed(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth, 'CL-X');
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->approve($auth['token'], $id, $preview)->assertCreated();
        $image = $this->images($id)->first();
        // Belt and braces: even if a purge were forced through, execution must not materialise or attach it.
        app(DocumentStorageService::class)->delete($image->storage_profile, $image->storage_key);
        $image->forceFill(['purged_at' => now()])->save();

        $response = $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'cl-exec-0009')->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => 1]);
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count(), 'no image is attached from a purged object');
        // The live recomputation no longer matches what was approved: the run is refused before anything is written.
        $response->assertStatus(409)->assertJsonPath('error.code', 'approval_stale');
    }

    /** @test */
    public function a_purged_remote_image_is_fetched_again_under_a_numbered_key_or_reported_when_it_cannot_be(): void
    {
        $auth = $this->registerTenant();
        config(['product_import_media.remote_enabled' => true]);
        $bytes = $this->png(0x123456);
        Http::fake(['img.example/*' => fn () => Http::response($bytes, 200, ['Content-Type' => 'image/png'])]); // a fresh body per request
        $id = $this->makeAction($auth, [$this->good('a', 2, 'CL-U', ['primary_image_url' => 'https://img.example/p.png'])]);
        $first = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('ready', $this->rows($first)['a']['images']['items'][0]['status']);
        $this->age(35);
        $this->assertSame(1, $this->retention()->run()['images']);

        // Fetching is still allowed: the picture is staged afresh and the purged row is only history.
        $again = $this->preview($auth['token'], $id, 1, 'cl-preview-0002')->assertCreated()->json('data');
        $this->assertSame('ready', $this->rows($again)['a']['images']['items'][0]['status'], json_encode($this->rows($again)['a']['images']['items'][0]));
        $rows = $this->images($id);
        $this->assertCount(2, $rows);
        $this->assertSame(1, $rows->whereNull('purged_at')->count());
        $this->assertStringEndsWith('#2', (string) $rows->whereNull('purged_at')->first()->source_key);
        $this->age(35);
        $this->assertSame(1, $this->retention()->run()['images'], 'the numbered row is purged like any other');

        // Fetching switched off since: nothing can restore the bytes, and the reviewer is told so (blocking).
        config(['product_import_media.remote_enabled' => false]);
        $blocked = $this->preview($auth['token'], $id, 1, 'cl-preview-0003')->assertCreated()->json('data');
        $this->assertSame('error', $this->rows($blocked)['a']['images']['items'][0]['status']);
        $this->assertSame('image_purged', $this->rows($blocked)['a']['images']['items'][0]['code']);
        $this->assertFalse($blocked['approvable']);
    }

    /** @test */
    public function a_repair_copies_only_images_that_still_exist_and_never_shares_objects_with_its_origin(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth, 'CL-R');
        $origin = AiAction::withoutGlobalScopes()->findOrFail($id);
        $repair = AiAction::withoutGlobalScopes()->create(['tenant_id' => $origin->tenant_id, 'type' => $origin->type, 'schema_version' => $origin->schema_version, 'status' => 'created', 'version' => 1, 'created_by' => $origin->created_by]);
        $source = $this->images($id)->first();
        $actor = \App\Models\User::withoutGlobalScopes()->findOrFail($origin->created_by);
        app(\App\Tenancy\TenantContext::class)->set($origin->tenant_id);

        $written = [];
        $this->assertSame(1, app(\App\Services\AiActionProductImageStager::class)->copyBetween($origin, $repair, [$source->id], $actor, $written));
        $copy = $this->images($repair->id)->first();
        $this->assertNotSame($source->storage_key, $copy->storage_key, 'a copy has its own objects');
        $this->assertNotSame($source->thumb_key, $copy->thumb_key);

        // The origin is purged (it is stale); the repair's copy survives, because they share nothing.
        $this->age(35);
        DB::table('ai_actions')->where('id', $repair->id)->update(['updated_at' => now()]);
        DB::table('ai_action_images')->where('id', $copy->id)->update(['created_at' => now()]);
        $result = $this->retention()->run();
        $this->assertSame(1, $result['images']);
        $this->assertFalse($this->exists($source));
        $this->assertTrue($this->exists($copy) && $this->exists($copy, true));

        // Copying from a purged source copies nothing (the reviewer re-supplies the ZIP).
        $written = [];
        $this->assertSame(0, app(\App\Services\AiActionProductImageStager::class)->copyBetween($origin, $repair, [$source->id], $actor, $written));
        $this->assertSame([], $written);
    }
}
