<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\ImportPreview;
use App\Services\ImportJobService;
use App\Services\ImportPreviewService;
use App\Support\ImportPreviewException;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H1-S3c — إنفاق المعاينة أحادية الاستعمال تحت **تزامن حقيقي** (PostgreSQL + عمليات `pcntl_fork`).
 *
 * ضمانة «معاينة واحدة ⇒ تشغيلة واحدة على الأكثر» تقوم على تحديثٍ شرطيّ (`consumed_at IS NULL AND expires_at > now`): الطلب الثاني
 * ينتظر قفل الصفّ حتى يلتزم الأول ثم يُعيد تقييم الشرط فيجد صفراً. اختبار SQLite لا يُظهر تنافساً على أقفال الصفوف، فهذا الصنف يبرهن الحدّ
 * على PostgreSQL فعلياً. **لا يُتخطّى** إن غاب `pcntl` على PostgreSQL: يفشل (كاختبارات ZATCA المتزامنة).
 */
class ImportPreviewConcurrencyPostgresTest extends TestCase
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
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        Storage::fake('local');
        $this->dir = sys_get_temp_dir().'/import_preview_race_'.uniqid();
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

    private function tenant(): string
    {
        $auth = $this->registerTenant('race-'.substr(md5((string) microtime(true)), 0, 8), 'race'.uniqid().'@pb.test');
        $this->tenants[] = $auth['tenant_id'];

        return $auth['tenant_id'];
    }

    /** @test */
    public function concurrent_consumption_of_one_preview_succeeds_exactly_once(): void
    {
        $tenant = $this->tenant();
        $previewId = (string) \Illuminate\Support\Str::uuid();
        DB::table('import_previews')->insert([
            'id' => $previewId, 'tenant_id' => $tenant, 'domain' => 'product_catalog',
            'file_sha256' => str_repeat('a', 64), 'options' => '{}', 'preview_hash' => str_repeat('b', 64),
            'expires_at' => now('UTC')->addHour(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        $jobs = [];
        foreach (range(1, 8) as $i) {
            $jobs[] = function () use ($tenant, $previewId, $i) {
                app(TenantContext::class)->set($tenant);
                $preview = ImportPreview::query()->whereKey($previewId)->firstOrFail();
                app(ImportPreviewService::class)->consume($preview, (string) \Illuminate\Support\Str::uuid());

                return $i;
            };
        }
        $results = $this->runConcurrently($jobs);

        $winners = array_filter($results, fn ($r) => ($r['ok'] ?? false) === true);
        $this->assertCount(1, $winners, 'مستهلكٌ واحد فقط يفوز: '.json_encode($results, JSON_UNESCAPED_UNICODE));
        foreach ($results as $result) {
            if (! ($result['ok'] ?? false)) {
                $this->assertSame(ImportPreviewException::class, $result['error_class'] ?? null, $result['message'] ?? '');
            }
        }
        $this->assertNotNull(DB::table('import_previews')->where('id', $previewId)->value('consumed_at'));
    }

    /** @test */
    public function concurrent_job_creation_with_one_preview_yields_exactly_one_job(): void
    {
        $tenant = $this->tenant();
        $csv = $this->dir.'/catalog.csv';
        file_put_contents($csv, "sku,name,type,sale_price\nRACE-1,منتج,good,10.00\n");

        app(TenantContext::class)->set($tenant);
        $binding = app(ImportPreviewService::class)->issue(
            'product_catalog', new UploadedFile($csv, 'catalog.csv', 'text/csv', null, true), null, ['mode' => 'create'], null
        );

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($tenant, $csv, $binding, $i) {
                app(TenantContext::class)->set($tenant);
                $job = app(ImportJobService::class)->create(
                    new UploadedFile($csv, 'catalog.csv', 'text/csv', null, true),
                    'product_catalog', null, null, null, ['mode' => 'create'], $binding['id'], $binding['hash'],
                );

                return $job->id;
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertSame(1, ImportJob::withoutGlobalScopes()->where('tenant_id', $tenant)->count(), 'معاينة واحدة ⇒ تشغيلة واحدة: '.json_encode($results, JSON_UNESCAPED_UNICODE));
        $created = array_values(array_filter($results, fn ($r) => ($r['ok'] ?? false) === true));
        $this->assertNotEmpty($created, 'واحدٌ على الأقل ينجح (والإعادة المطابقة قد تُعيد التشغيلة نفسها).');
        $ids = array_unique(array_map(fn ($r) => $r['value'], $created));
        $this->assertCount(1, $ids, 'كل ناجحٍ يرى التشغيلة نفسها.');
        foreach ($results as $result) {
            if (! ($result['ok'] ?? false)) {
                $this->assertSame(ImportPreviewException::class, $result['error_class'] ?? null, $result['message'] ?? '');
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
