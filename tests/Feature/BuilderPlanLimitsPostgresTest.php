<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\PreviewSession;
use App\Models\Tenant;
use App\Services\AppBuilder\BuilderAppService;
use App\Services\AppBuilder\BuilderPublishedExperienceVersionService;
use App\Services\AppBuilder\PlanLimitExceededException;
use App\Services\AppBuilder\PreviewSessionService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * DRF-07 (S02c) — حدود الكمية تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`): N طلبات متزامنة عند حافة الحدّ ⇒ لا يتجاوزه أحد
 * (قفل صفّ المستأجر للتطبيقات، وصفّ التطبيق للنسخ والمعاينة). على PostgreSQL لا يُتخطّى إن غاب `pcntl`؛ يُتخطّى على SQLite فقط.
 */
class BuilderPlanLimitsPostgresTest extends TestCase
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
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');
        $this->dir = sys_get_temp_dir().'/builder_plan_limits_'.uniqid();
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
                DB::table('tenants')->where('id', $id)->delete();
            }
        }
        parent::tearDown();
    }

    private function tenant(array $limits): string
    {
        $tenant = Tenant::create([
            'name' => 'مستأجر حدود', 'slug' => 'drf07-pg-'.Str::random(10), 'vat_number' => '300000000000003',
            'currency' => 'SAR', 'is_active' => true, 'plan_limits' => $limits,
        ])->id;
        $this->tenants[] = $tenant;

        return $tenant;
    }

    private function enter(string $tenant): void
    {
        app(TenantContext::class)->set($tenant);
    }

    /** @test */
    public function concurrent_app_creation_never_exceeds_the_tenant_limit(): void
    {
        $tenant = $this->tenant(['builder_apps' => 3]);

        $jobs = [];
        foreach (range(1, 8) as $i) {
            $jobs[] = function () use ($tenant, $i) {
                $this->enter($tenant);
                try {
                    app(BuilderAppService::class)->create("تطبيق {$i}", null, BuilderApp::SOURCE_SCRATCH, null);

                    return 'ok';
                } catch (PlanLimitExceededException) {
                    return 'limit';
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(3, count(array_filter($results, fn ($r) => $r['value'] === 'ok')));
        $this->assertSame(5, count(array_filter($results, fn ($r) => $r['value'] === 'limit')));
        $this->assertSame(3, (int) DB::table('builder_apps')->where('tenant_id', $tenant)->count());
    }

    /** @test */
    public function concurrent_publishes_never_exceed_the_per_app_version_limit(): void
    {
        $tenant = $this->tenant(['builder_versions_per_app' => 2]);
        $this->enter($tenant);
        $appId = app(BuilderAppService::class)->create('تطبيق نسخ', null, BuilderApp::SOURCE_SCRATCH, null)->id;

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($tenant, $appId) {
                $this->enter($tenant);
                try {
                    app(BuilderPublishedExperienceVersionService::class)->publish(BuilderApp::findOrFail($appId), null, null);

                    return 'ok';
                } catch (PlanLimitExceededException) {
                    return 'limit';
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(2, count(array_filter($results, fn ($r) => $r['value'] === 'ok')));
        $versions = DB::table('builder_published_experience_versions')->where('builder_app_id', $appId)->pluck('version')->map(fn ($v) => (int) $v)->sort()->values()->all();
        $this->assertSame([1, 2], $versions, 'نسختان متتاليتان بلا تجاوز ولا تكرار');
    }

    /** @test */
    public function concurrent_preview_issuance_never_exceeds_the_active_session_limit(): void
    {
        $tenant = $this->tenant(['builder_active_previews' => 2]);
        $this->enter($tenant);
        $appId = app(BuilderAppService::class)->create('تطبيق معاينة', null, BuilderApp::SOURCE_SCRATCH, null)->id;

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($tenant, $appId) {
                $this->enter($tenant);
                try {
                    app(PreviewSessionService::class)->issueForDraft(BuilderApp::findOrFail($appId), null, PreviewSession::CHANNEL_BROWSER);

                    return 'ok';
                } catch (PlanLimitExceededException) {
                    return 'limit';
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllCompleted($results);
        $this->assertSame(2, count(array_filter($results, fn ($r) => $r['value'] === 'ok')));
        $this->assertSame(2, (int) DB::table('preview_sessions')->where('builder_app_id', $appId)->count());
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
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
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
