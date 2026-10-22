<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\ImportJobUnit;
use App\Models\Product;
use App\Services\ImportJobService;
use App\Support\ImportUnitRef;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * IMP-H1-S8b — مطالبة وحدات الإصلاح تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): أربع تشغيلات فرعية على معرّفات المصدر نفسها تُرحَّل معاً؛
 * كل وحدة تُنتزع من تشغيلةٍ واحدةٍ فقط (`UPDATE … WHERE status='failed'` ينتظر قفل الصفّ ثم يُعيد تقييم الشرط)، فلا يتكرّر منتج، والخاسرات تفشل
 * بلا كتابة. **لا يُتخطّى** إن غاب `pcntl` على PostgreSQL: يفشل.
 */
class ImportRepairClaimConcurrencyPostgresTest extends TestCase
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
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        Storage::fake('local');
        $this->dir = sys_get_temp_dir().'/import_repair_race_'.uniqid();
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

    /** @test */
    public function racing_children_repair_each_unit_exactly_once(): void
    {
        $auth = $this->registerTenant('race-'.substr(md5((string) microtime(true)), 0, 8), 'race'.uniqid().'@pb.test');
        $tenant = $auth['tenant_id'];
        $this->tenants[] = $tenant;
        app(TenantContext::class)->set($tenant);

        $parentId = (string) Str::uuid();
        DB::table('import_jobs')->insert([
            'id' => $parentId, 'tenant_id' => $tenant, 'domain' => 'product_catalog', 'status' => 'failed',
            'original_filename' => 'p.csv', 'extension' => 'csv', 'storage_disk' => 'local', 'storage_path' => 'x',
            'content_sha256' => str_repeat('a', 64), 'byte_size' => 1, 'row_count' => 5, 'processed_rows' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $lines = ['sku,name,type,sale_price,_awj_unit_ref'];
        for ($i = 0; $i < 5; $i++) {
            $ref = ImportUnitRef::for($parentId, $i);
            DB::table('import_job_units')->insert([
                'id' => (string) Str::uuid(), 'tenant_id' => $tenant, 'import_job_id' => $parentId, 'source_unit_ref' => $ref,
                'unit_ordinal' => $i, 'status' => 'failed', 'error_code' => 'row_invalid', 'created_at' => now(), 'updated_at' => now(),
            ]);
            $lines[] = "RC-{$i},منتج {$i},good,10.00,{$ref}";
        }
        $csv = implode("\n", $lines)."\n";

        $children = [];
        foreach (range(1, 4) as $n) {
            $path = $this->dir."/child{$n}.csv";
            file_put_contents($path, $csv);
            $children[] = app(ImportJobService::class)->create(
                new UploadedFile($path, "child{$n}.csv", 'text/csv', null, true), 'product_catalog', null, null, null, ['mode' => 'create'], null, null, $parentId,
            )->id;
        }

        $jobs = [];
        foreach ($children as $childId) {
            $jobs[] = function () use ($tenant, $childId) {
                app(TenantContext::class)->set($tenant);
                $job = ImportJob::query()->whereKey($childId)->firstOrFail();

                return app(ImportJobService::class)->applyNextChunk($job, ['mode' => 'create'], null, true)->status;
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertSame(5, Product::query()->count(), 'لا تكرار: كل وحدة كُتبت مرة واحدة. '.json_encode($results, JSON_UNESCAPED_UNICODE));
        $owners = ImportJobUnit::query()->where('import_job_id', $parentId)->pluck('repaired_by_job_id')->unique()->values()->all();
        $this->assertCount(1, $owners, 'كل الوحدات انتُزعت من تشغيلةٍ واحدة.');
        $this->assertContains($owners[0], $children);
        $this->assertSame(1, ImportJob::query()->whereIn('id', $children)->where('status', 'completed')->count());
        $this->assertSame(3, ImportJob::query()->whereIn('id', $children)->where('status', 'failed')->count());
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
