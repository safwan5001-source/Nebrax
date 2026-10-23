<?php

namespace Tests\Feature;

use App\Models\UnitTemplate;
use App\Services\UnitTemplateImportService;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-H4-S3 — تفرّد اسم قالب الوحدات تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): لا قيد قاعدة يحرسه، فأربعة استيرادات متزامنة لثلاثين قالباً بالأسماء نفسها
 * تُنتج كل قالب مرةً واحدة، وينجح استيرادٌ واحد ويفشل الباقي بصفٍّ مرفوضٍ مسمّى، لأن التحليل والكتابة تجريان تحت القفل الاستشاري للمستأجر. **لا يُتخطّى** إن غاب `pcntl`.
 */
class UnitTemplateImportConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على الأقفال.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/unit_template_import_race_'.uniqid();
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

    /** @return array{0: string, 1: list<callable>} */
    private function racers(): array
    {
        $auth = $this->registerTenant('utrace-'.substr(md5((string) microtime(true)), 0, 8), 'utrace'.uniqid().'@pb.test');
        $tenant = $auth['tenant_id'];
        $this->tenants[] = $tenant;
        app(TenantContext::class)->set($tenant);

        $csv = "template_name,base_unit,unit_name,factor\n";
        foreach (range(1, 30) as $n) {
            $csv .= "قالب {$n},قطعة,كرتون,12\n";
        }
        $jobs = [];
        foreach (range(1, 4) as $n) {
            $path = $this->dir."/u{$n}.csv";
            file_put_contents($path, $csv);
            $jobs[] = function () use ($tenant, $path, $n) {
                app(TenantContext::class)->set($tenant);

                return app(UnitTemplateImportService::class)->apply(new UploadedFile($path, "u{$n}.csv", 'text/csv', null, true), []);
            };
        }

        return [$tenant, $jobs];
    }

    /** @test */
    public function four_racing_imports_create_each_template_once_and_the_losers_fail_with_a_named_row_failure(): void
    {
        [$tenant, $jobs] = $this->racers();

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(30, UnitTemplate::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertCount(1, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true));
        foreach ($results as $result) {
            if (($result['ok'] ?? false) !== true) {
                $this->assertSame(\App\Support\ImportUnitFailureException::class, $result['error_class'] ?? null, (string) ($result['message'] ?? ''));
            }
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
                DB::connection()->getPdo();
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
