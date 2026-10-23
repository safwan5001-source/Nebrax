<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Services\PartnerImportService;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-H3-S1 — إشارات التكرار تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): أربعة استيرادات متزامنة بالرقم الضريبي نفسه وأكواد مختلفة بسياسة `error`
 * (ثم `skip`) تُنتج طرفاً واحداً فقط، لأن المطابقة والكتابة تجريان تحت القفل الاستشاري للمستأجر. **لا يُتخطّى** إن غاب `pcntl` على PostgreSQL: يفشل.
 */
class PartnerImportConcurrencyPostgresTest extends TestCase
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

        $this->dir = sys_get_temp_dir().'/partner_import_race_'.uniqid();
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
    private function racers(string $policy): array
    {
        $auth = $this->registerTenant('prace-'.substr(md5((string) microtime(true)), 0, 8), 'prace'.uniqid().'@pb.test');
        $tenant = $auth['tenant_id'];
        $this->tenants[] = $tenant;
        app(TenantContext::class)->set($tenant);

        $jobs = [];
        foreach (range(1, 4) as $n) {
            $path = $this->dir."/p{$n}.csv";
            file_put_contents($path, "code,name,vat_number\nR-{$n},طرف {$n},300000000000003\n");
            $jobs[] = function () use ($tenant, $path, $n, $policy) {
                app(TenantContext::class)->set($tenant);
                $file = new UploadedFile($path, "p{$n}.csv", 'text/csv', null, true);

                return app(PartnerImportService::class)->apply($file, ['type' => 'customer', 'duplicate_signal_policy' => $policy]);
            };
        }

        return [$tenant, $jobs];
    }

    /** @test */
    public function four_racing_imports_with_the_same_vat_create_one_partner_under_error(): void
    {
        [$tenant, $jobs] = $this->racers('error');

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Partner::query()->where('vat_number', '300000000000003')->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $ok = array_filter($results, fn ($r) => ($r['ok'] ?? false) === true);
        $this->assertCount(1, $ok, 'استيرادٌ واحد ينجح والبقية تفشل بصفٍّ مرفوض.');
        foreach ($results as $result) {
            if (($result['ok'] ?? false) !== true) {
                $this->assertSame(\App\Support\ImportUnitFailureException::class, $result['error_class'] ?? null);
            }
        }
    }

    /** @test */
    public function four_racing_imports_under_skip_create_one_and_skip_the_rest(): void
    {
        [$tenant, $jobs] = $this->racers('skip');

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, Partner::query()->where('vat_number', '300000000000003')->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $created = array_sum(array_map(fn ($r) => (int) ($r['value']['created'] ?? 0), $results));
        $skipped = array_sum(array_map(fn ($r) => (int) ($r['value']['skipped'] ?? 0), $results));
        $this->assertSame([1, 3], [$created, $skipped]);
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
