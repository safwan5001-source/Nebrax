<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
use App\Models\Tenant;
use App\Services\AppBuilder\BuilderAppService;
use App\Services\AppBuilder\BuilderDraftExperienceService;
use App\Services\AppBuilder\DraftRevisionConflictException;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AD-01 (S01a) — القفل التفاؤلي للمسودة تحت تزامن حقيقي (PostgreSQL + عمليات `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) N كتّاب من الأساس نفسه (`base_revision`) ⇒ ينجح واحد فقط والباقي تعارض، وrevision = 1 بلا كتابة ضائعة.
 *  2) كتّاب يعيدون المحاولة بعد التعارض ⇒ ينجحون جميعاً وrevision = عددهم (تسلسل محكم، لا كتابة ضائعة).
 *  3) كتّاب **بلا** base_revision (مسار قديم) ⇒ لا يضيع أي تزايد في revision (كان يضيع قبل القفل).
 *  4) خليط قديم/تفاؤلي ⇒ revision النهائي = عدد النجاحات بالضبط.
 *  5) موت مفاجئ (SIGKILL) داخل المعاملة بعد قفل الصف ⇒ لا كتابة، والقفل ينفكّ، والحفظ التالي ينجح.
 *  6) مستأجران متزامنان ⇒ كلٌّ يتسلسل على مسودته فقط، بلا أثر متبادل ولا جمود.
 *
 *  يُنفَّذ الحفظ عبر `BuilderDraftExperienceService::save()` (السلطة الوحيدة، نفسها التي يستدعيها المتحكّم).
 *  على PostgreSQL **لا يُتخطّى** هذا الصنف إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط (لا أقفال صفوف).
 */
class BuilderDraftOptimisticLockPostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (AD-01).');

        $this->dir = sys_get_temp_dir().'/builder_draft_lock_'.uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete(); // يزيل التطبيقات والمسودات بالتسلسل
            }
        }

        parent::tearDown();
    }

    /** @test */
    public function exactly_one_of_many_concurrent_saves_from_the_same_base_revision_wins(): void
    {
        [$tenant, $draftId] = $this->makeDraft();

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = $this->saver($tenant, $draftId, "كاتب {$i}", baseRevision: 0);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $wins = array_values(array_filter($results, fn ($r) => $r['value']['status'] === 'ok'));
        $conflicts = array_values(array_filter($results, fn ($r) => $r['value']['status'] === 'conflict'));
        $this->assertCount(1, $wins, 'ينجح كاتب واحد فقط');
        $this->assertCount(5, $conflicts);
        foreach ($conflicts as $c) {
            $this->assertSame(1, $c['value']['current_revision'], 'التعارض يُبلغ بالـrevision الفائز');
            $this->assertSame(0, $c['value']['base_revision']);
        }

        $draft = DB::table('builder_draft_experiences')->where('id', $draftId)->first();
        $this->assertSame(1, (int) $draft->revision, 'لا كتابة ضائعة ولا زيادة مزدوجة');
        $this->assertSame($wins[0]['value']['marker'], $this->markerOf($draft), 'المخطط المحفوظ = مخطط الفائز بالضبط');
    }

    /** @test */
    public function retrying_writers_all_succeed_with_contiguous_revisions(): void
    {
        [$tenant, $draftId] = $this->makeDraft();

        $jobs = [];
        foreach (range(1, 5) as $i) {
            $jobs[] = function () use ($tenant, $draftId, $i) {
                $this->enter($tenant);
                $service = app(BuilderDraftExperienceService::class);
                for ($attempt = 1; $attempt <= 60; $attempt++) {
                    $draft = BuilderDraftExperience::findOrFail($draftId);
                    try {
                        $saved = $service->save($draft, $this->schemaFor("مُعيد {$i}"), null, (int) $draft->revision);

                        return ['status' => 'ok', 'attempts' => $attempt, 'revision' => (int) $saved->revision];
                    } catch (DraftRevisionConflictException) {
                        usleep(random_int(500, 4000));
                    }
                }

                return ['status' => 'gave_up'];
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        foreach ($results as $i => $r) {
            $this->assertSame('ok', $r['value']['status'], "الكاتب {$i} نجح بعد إعادة المحاولة");
        }
        $revisions = array_map(fn ($r) => $r['value']['revision'], $results);
        sort($revisions);
        $this->assertSame([1, 2, 3, 4, 5], $revisions, 'كل نجاح أخذ revision فريداً متتالياً');
        $this->assertSame(5, (int) DB::table('builder_draft_experiences')->where('id', $draftId)->value('revision'));
    }

    /** @test */
    public function writers_without_base_revision_never_lose_a_revision_increment(): void
    {
        [$tenant, $draftId] = $this->makeDraft();

        $jobs = [];
        foreach (range(1, 8) as $i) {
            $jobs[] = $this->saver($tenant, $draftId, "قديم {$i}", baseRevision: null);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        foreach ($results as $r) {
            $this->assertSame('ok', $r['value']['status'], 'المسار القديم لا يعارض أبداً (توافق رجعي)');
        }
        $this->assertSame(8, (int) DB::table('builder_draft_experiences')->where('id', $draftId)->value('revision'),
            'ثمانية حفظات = ثمانية تزايدات (قبل القفل كانت تضيع)');
    }

    /** @test */
    public function mixed_legacy_and_optimistic_writers_end_with_revision_equal_to_the_number_of_successes(): void
    {
        [$tenant, $draftId] = $this->makeDraft();

        $jobs = [];
        foreach (range(1, 4) as $i) {
            $jobs[] = $this->saver($tenant, $draftId, "قديم {$i}", baseRevision: null);
            $jobs[] = $this->saver($tenant, $draftId, "تفاؤلي {$i}", baseRevision: 0);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $successes = count(array_filter($results, fn ($r) => $r['value']['status'] === 'ok'));
        $this->assertGreaterThanOrEqual(4, $successes, 'الكتّاب القدامى الأربعة ينجحون دائماً');
        $this->assertLessThanOrEqual(5, $successes, 'تفاؤلي واحد على الأكثر ينجح من الأساس 0');
        $this->assertSame($successes, (int) DB::table('builder_draft_experiences')->where('id', $draftId)->value('revision'));
    }

    /** @test */
    public function a_writer_killed_while_holding_the_row_lock_leaves_no_write_and_releases_the_lock(): void
    {
        [$tenant, $draftId] = $this->makeDraft();
        $dir = $this->dir;

        $pid = pcntl_fork();
        $this->assertNotSame(-1, $pid, 'pcntl_fork');
        if ($pid === 0) {
            DB::purge(config('database.default'));
            $this->enter($tenant);
            Event::listen('eloquent.updating: '.BuilderDraftExperience::class, function () use ($dir): void {
                touch($dir.'/locked_and_updating');
                sleep(30); // يُقتل بعد قفل الصف وقبل التثبيت
            });
            try {
                app(BuilderDraftExperienceService::class)->save(BuilderDraftExperience::findOrFail($draftId), $this->schemaFor('يُقتل'), null, 0);
            } catch (\Throwable) {
            }
            exit(0);
        }

        $this->waitFor($dir.'/locked_and_updating', 15.0);
        posix_kill($pid, SIGKILL);
        pcntl_waitpid($pid, $status);

        $this->assertSame(0, (int) DB::table('builder_draft_experiences')->where('id', $draftId)->value('revision'), 'لا كتابة من العملية المقتولة');

        $this->enter($tenant);
        $saved = app(BuilderDraftExperienceService::class)->save(BuilderDraftExperience::findOrFail($draftId), $this->schemaFor('بعد الموت'), null, 0);
        $this->assertSame(1, (int) $saved->revision, 'القفل انفكّ والحفظ التالي بنفس الأساس ينجح');
    }

    /** @test */
    public function concurrent_saves_in_two_tenants_serialize_independently_without_deadlock(): void
    {
        [$tenantA, $draftA] = $this->makeDraft();
        [$tenantB, $draftB] = $this->makeDraft();

        $jobs = [];
        foreach (range(1, 4) as $i) {
            $jobs[] = $this->saver($tenantA, $draftA, "أ{$i}", baseRevision: null);
            $jobs[] = $this->saver($tenantB, $draftB, "ب{$i}", baseRevision: null);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(4, (int) DB::table('builder_draft_experiences')->where('id', $draftA)->value('revision'));
        $this->assertSame(4, (int) DB::table('builder_draft_experiences')->where('id', $draftB)->value('revision'));
        $this->assertStringStartsWith('أ', $this->markerOf(DB::table('builder_draft_experiences')->where('id', $draftA)->first()));
        $this->assertStringStartsWith('ب', $this->markerOf(DB::table('builder_draft_experiences')->where('id', $draftB)->first()));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @return array{0: string, 1: string} [tenantId, draftId] */
    private function makeDraft(): array
    {
        $tenant = Tenant::create([
            'name' => 'مستأجر قفل المسودة', 'slug' => 'ad01-pg-'.Str::random(10),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ])->id;
        $this->tenants[] = $tenant;

        $this->enter($tenant);
        $app = app(BuilderAppService::class)->create('تطبيق قفل', null, BuilderApp::SOURCE_SCRATCH, null);

        return [$tenant, BuilderDraftExperience::query()->where('builder_app_id', $app->id)->value('id')];
    }

    private function enter(string $tenant): void
    {
        app(TenantContext::class)->set($tenant);
    }

    /** @return array<string, mixed> */
    private function schemaFor(string $marker): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [['type' => 'Text', 'id' => 'home-text', 'props' => ['text' => $marker]]];

        return $schema;
    }

    private function markerOf(object $row): string
    {
        return json_decode($row->schema, true)['pages']['home']['children'][0]['props']['text'];
    }

    private function saver(string $tenant, string $draftId, string $marker, ?int $baseRevision): callable
    {
        return function () use ($tenant, $draftId, $marker, $baseRevision) {
            $this->enter($tenant);
            try {
                $saved = app(BuilderDraftExperienceService::class)->save(
                    BuilderDraftExperience::findOrFail($draftId), $this->schemaFor($marker), null, $baseRevision,
                );

                return ['status' => 'ok', 'marker' => $marker, 'revision' => (int) $saved->revision];
            } catch (DraftRevisionConflictException $e) {
                return ['status' => 'conflict', 'current_revision' => $e->currentRevision, 'base_revision' => $e->baseRevision];
            }
        };
    }

    private function waitFor(string $file, float $seconds = 10.0): void
    {
        $deadline = microtime(true) + $seconds;
        while (! file_exists($file) && microtime(true) < $deadline) {
            usleep(1_000);
        }
    }

    private function assertAllCompleted(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier_'.uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir.'/result_'.uniqid()."_{$i}";
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    $value = $job();
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $value]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode([
                        'ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage(),
                    ]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
