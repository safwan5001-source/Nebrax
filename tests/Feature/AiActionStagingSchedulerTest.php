<?php

namespace Tests\Feature;

use App\Models\AiActionImage;
use App\Services\AiActionStagedImageRetention;
use App\Services\DocumentCenter\DocumentStorageService;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use ZipArchive;

/**
 * AI-ACTIONS-08: the cleanup is registered the way the existing `awj-scheduler` cron service (`schedule:run` every
 * 5 minutes) can run it safely and observably, and it never claims a removal it could not prove from the host it runs on.
 */
class AiActionStagingSchedulerTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiProductActions;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['document_center.storage.driver' => 'local', 'document_center.storage.disk' => 'local']);
    }

    private function event(string $needle)
    {
        return collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, $needle));
    }

    private function draft(array $auth, string $sku, string $key): string
    {
        $id = $this->makeAction($auth, [$this->good('a', 2, $sku)], $key);
        $image = imagecreatetruecolor(8, 8);
        imagefill($image, 0, 0, crc32($sku) & 0xFFFFFF);
        ob_start();
        imagepng($image);
        $png = (string) ob_get_clean();
        $path = tempnam(sys_get_temp_dir(), 'ai-sched-test-');
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        $zip->addFromString($sku.'.png', $png);
        $zip->close();
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', $key.'-zip')
            ->post("/api/ai-actions/{$id}/image-archives", ['expected_version' => 1, 'archive' => new UploadedFile($path, 'images.zip', 'application/zip', null, true)], ['Accept' => 'application/json'])
            ->assertCreated();

        return $id;
    }

    private function age(int $days): void
    {
        $at = now()->subDays($days);
        DB::table('ai_actions')->update(['updated_at' => $at]);
        DB::table('ai_action_images')->update(['created_at' => $at]);
        DB::table('ai_action_events')->update(['occurred_at' => $at]);
    }

    private function images(string $id)
    {
        return AiActionImage::withoutGlobalScopes()->where('ai_action_id', $id)->orderBy('id')->get();
    }

    /** @test */
    public function the_cleanup_is_scheduled_daily_for_the_existing_cron_scheduler_with_bounded_visible_unlocked_runs(): void
    {
        $event = $this->event('ai-actions:purge-staged-images');

        $this->assertNotNull($event, 'the purge must be scheduled');
        $this->assertSame('50 3 * * *', $event->expression);
        $this->assertStringContainsString('--max-seconds=240', (string) $event->command, 'one tick can never outlive the 5 minute cron interval');
        $this->assertTrue($event->withoutOverlapping);
        $this->assertSame(30, $event->expiresAt, 'a crashed run must not block the job for the 24h default');
        $this->assertTrue($event->onOneServer);
        $this->assertSame('/proc/1/fd/1', $event->output, 'the result line must reach the cron service log, not /dev/null');

        // Dark by default: a deploy of main never starts a destructive job by itself; the owner enables it explicitly.
        $this->assertFalse(config('ai_actions.staging_purge_schedule_enabled'));
        $this->assertFalse($event->filtersPass($this->app));
        config(['ai_actions.staging_purge_schedule_enabled' => true]);
        $this->assertTrue($event->filtersPass($this->app));

        // The sibling retention jobs the same scheduler runs stay registered (nothing was displaced).
        foreach (['ai:prune-records', 'imports:prune', 'documents:sweep-scans'] as $other) {
            $this->assertNotNull($this->event($other), "{$other} must stay scheduled");
        }
        $this->assertContains('ai-actions:purge-staged-images', array_keys(Artisan::all()));
    }

    /** @test */
    public function it_is_due_only_at_the_0350_tick_of_the_5_minute_cron(): void
    {
        $event = $this->event('ai-actions:purge-staged-images');
        $tz = config('app.timezone');

        foreach (['03:45', '03:55', '12:00'] as $time) {
            Carbon::setTestNow(Carbon::parse("2026-10-22 {$time}:00", $tz));
            $this->assertFalse($event->isDue($this->app), "not due at {$time}");
        }
        Carbon::setTestNow(Carbon::parse('2026-10-22 03:50:00', $tz));
        $this->assertTrue($event->isDue($this->app));
        Carbon::setTestNow();
    }

    /** @test */
    public function a_clean_run_reports_one_stable_status_line_and_exits_zero(): void
    {
        $this->assertSame(0, Artisan::call('ai-actions:purge-staged-images', ['--max-seconds' => 240]));
        $this->assertMatchesRegularExpression('/^ai-actions:purge-staged-images status=ok actions=0 images=0 bytes=0 failed=0 unsafe=0 unverifiable=0 remaining=0 duration_ms=\d+$/m', Artisan::output());
    }

    /** @test */
    public function a_local_disk_object_this_host_cannot_see_is_unverifiable_not_purged(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth, 'SCH-1', 'sch-act-0001');
        $image = $this->images($id)->first();
        $this->age(35);
        // Another host's disk: the bytes are not here, so "missing" proves nothing about the real object.
        Storage::disk('local')->delete([$image->storage_key, (string) $image->thumb_key]);

        $dry = app(AiActionStagedImageRetention::class)->run(true);
        $this->assertSame(1, $dry['unverifiable']);
        $this->assertSame(0, $dry['images']);

        $this->assertSame(1, Artisan::call('ai-actions:purge-staged-images'), 'attention: a human must look');
        $output = Artisan::output();
        $this->assertStringContainsString('status=attention', $output);
        $this->assertStringContainsString('unverifiable=1', $output);
        $this->assertNull($image->fresh()->purged_at, 'the database never claims a removal that was not proved');
    }

    /** @test */
    public function a_durable_object_that_is_already_gone_is_marked_purged_without_a_host_check(): void
    {
        $auth = $this->registerTenant();
        $id = $this->draft($auth, 'SCH-2', 'sch-act-0002');
        $image = $this->images($id)->first();
        DB::table('ai_action_images')->where('id', $image->id)->update(['storage_profile' => DocumentStorageService::PROFILE_DURABLE]);
        $this->age(35);

        $deleted = [];
        $this->partialMock(DocumentStorageService::class, function ($mock) use (&$deleted): void {
            $mock->shouldReceive('exists')->never(); // durable storage is the same from every host: no host proof needed
            $mock->shouldReceive('delete')->andReturnUsing(function (string $profile, string $key) use (&$deleted): void {
                $deleted[] = [$profile, $key]; // deleting an absent object is a no-op on S3/R2
            });
        });

        $result = app(AiActionStagedImageRetention::class)->run();
        $this->assertSame(1, $result['images']);
        $this->assertSame(0, $result['unverifiable']);
        $this->assertCount(2, $deleted);
        $this->assertNotNull($image->fresh()->purged_at);
        $this->assertSame(0, app(AiActionStagedImageRetention::class)->run()['images'], 'a rerun changes nothing');
    }

    /** @test */
    public function a_run_stops_starting_new_work_after_its_time_budget_and_the_next_run_resumes(): void
    {
        $auth = $this->registerTenant();
        $first = $this->draft($auth, 'SCH-3', 'sch-act-0003');
        $second = $this->draft($auth, 'SCH-4', 'sch-act-0004');
        $this->age(35);

        $real = app(DocumentStorageService::class);
        $this->partialMock(DocumentStorageService::class, function ($mock) use ($real): void {
            $mock->shouldReceive('delete')->andReturnUsing(function (string $profile, string $key) use ($real): void {
                usleep(600_000); // each object is slow: two objects per image outlast the 1 second budget
                $real->delete($profile, $key);
            });
        });

        $run = app(AiActionStagedImageRetention::class)->run(false, null, 500, 1);
        $this->assertSame(1, $run['actions']);
        $this->assertSame(1, $run['remaining']);
        $this->assertSame(1, AiActionImage::withoutGlobalScopes()->whereNull('purged_at')->count());

        $next = app(AiActionStagedImageRetention::class)->run(false, null, 500, 0);
        $this->assertSame(1, $next['actions']);
        $this->assertSame(0, $next['remaining']);
        $this->assertSame(0, AiActionImage::withoutGlobalScopes()->whereNull('purged_at')->count());
        $this->assertCount(1, $this->images($first));
        $this->assertCount(1, $this->images($second));
    }
}
